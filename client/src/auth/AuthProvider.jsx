import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { supabase, authConfigured, fetchEnabledProviders } from "./supabaseClient.js";
import { setUserScope, resetBrowserId } from "../identity.js";
import { STORAGE_KEY, JOBS_STORAGE_KEY, JOBS_RESULT_KEY } from "../constants.js";

/**
 * Supabase auth state for the whole tree.
 *
 * `loading` is true only until the persisted session has been read back from
 * storage. RequireAuth waits on it — redirecting to /sign-in before that read
 * finishes would bounce a signed-in user out of the app on every refresh.
 *
 * `onAuthStateChange` is the single writer after that: sign-in, sign-out, token
 * refresh and a sign-out in another tab all arrive through it.
 */

const AuthContext = createContext(null);

// Per-browser data that belongs to whoever was using the app, not to the
// browser: the in-progress interview mirror and the Job Matches resume cache.
// Cleared on sign-out so the next person to sign in here doesn't inherit them.
function clearUserScopedStorage() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(JOBS_RESULT_KEY);
  } catch {
    // storage unavailable
  }
  try {
    localStorage.removeItem(JOBS_STORAGE_KEY);
  } catch {
    // storage unavailable
  }
  // The anonymous per-browser owner id too, so signing out genuinely ends this
  // person's session on a shared machine rather than leaving their saved
  // interviews reachable by whoever uses the browser next.
  resetBrowserId();
}

/** Supabase's error strings are terse and sometimes internal; say it plainly. */
function friendlyAuthError(err) {
  const msg = (err?.message || "").toLowerCase();
  if (msg.includes("invalid login credentials")) {
    return "That email and password don't match an account.";
  }
  if (msg.includes("email not confirmed")) {
    return "Confirm your email first — check your inbox for the link we sent.";
  }
  if (msg.includes("already registered") || msg.includes("already been registered")) {
    return "An account with that email already exists. Sign in instead.";
  }
  if (msg.includes("password should be") || msg.includes("weak password")) {
    return err.message;
  }
  if (msg.includes("rate limit") || err?.status === 429) {
    return "Too many attempts. Wait a minute and try again.";
  }
  if (msg.includes("should be different")) {
    return "That's your current password — choose a different one.";
  }
  if (msg.includes("auth session missing") || msg.includes("session_not_found")) {
    return "This reset link has expired. Request a new one and try again.";
  }
  if (msg.includes("failed to fetch") || msg.includes("network")) {
    return "Couldn't reach the sign-in service. Check your connection and try again.";
  }
  return err?.message || "Something went wrong. Please try again.";
}

// Where to send the user after an OAuth round-trip. Router state doesn't
// survive a full-page redirect to Google/GitHub and back, so the deep-link
// destination rides in sessionStorage instead (same tab, so it's still there).
const RETURN_TO_KEY = "mockInterview:authReturnTo";

/** Read and clear the stored post-OAuth destination. */
export function takeAuthReturnTo() {
  try {
    const v = sessionStorage.getItem(RETURN_TO_KEY);
    sessionStorage.removeItem(RETURN_TO_KEY);
    return v;
  } catch {
    return null;
  }
}

const PROVIDER_LABELS = { google: "Google", github: "GitHub" };

function notConfigured() {
  return new Error(
    "Sign-in isn't configured. Set SUPABASE_URL and SUPABASE_ANON_KEY in client/.env and restart the dev server."
  );
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(authConfigured);

  useEffect(() => {
    if (!supabase) return undefined;
    let cancelled = false;

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (cancelled) return;
        // Point the API's owner id at this user BEFORE anything can render a
        // protected screen and start fetching, so the first request is already
        // scoped to the right account.
        setUserScope(data.session?.user?.id ?? null);
        setSession(data.session ?? null);
      })
      .catch(() => {
        if (!cancelled) setSession(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      if (cancelled) return;
      setUserScope(next?.user?.id ?? null);
      setSession(next ?? null);
      setLoading(false);
    });

    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
    };
  }, []);

  const signIn = useCallback(async (email, password) => {
    if (!supabase) throw notConfigured();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(friendlyAuthError(error));
    return data;
  }, []);

  /**
   * Resolves `{ needsConfirmation }`. When the Supabase project requires email
   * confirmation (the default), sign-up returns a user but no session — the
   * account isn't usable until the link in the email is followed.
   */
  const signUp = useCallback(async (email, password) => {
    if (!supabase) throw notConfigured();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${window.location.origin}/sign-in` },
    });
    if (error) throw new Error(friendlyAuthError(error));
    // Supabase answers a sign-up for an already-confirmed email with a user
    // that has no identities (so accounts can't be enumerated). Treat it as
    // "check your email" too — same message either way, by design.
    return { needsConfirmation: !data.session };
  }, []);

  /**
   * Send the "set a new password" email. Supabase deliberately answers the same
   * way whether or not the address has an account, so the caller must not say
   * "no such user" — the notice it shows is worded for both cases.
   *
   * The link lands on /reset-password, which must be in Supabase → Auth → URL
   * Configuration → Redirect URLs for every origin the app runs on.
   */
  const requestPasswordReset = useCallback(async (email) => {
    if (!supabase) throw notConfigured();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) throw new Error(friendlyAuthError(error));
  }, []);

  /**
   * Set a new password for whoever the current session belongs to. On the reset
   * path that session comes from the recovery link in the email.
   */
  const updatePassword = useCallback(async (password) => {
    if (!supabase) throw notConfigured();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw new Error(friendlyAuthError(error));
  }, []);

  /**
   * Google / GitHub. Leaves the page: the browser goes to the provider, then
   * to Supabase, then back to /sign-in with the session in the URL, which
   * `detectSessionInUrl` picks up. After that first time the session persists
   * like any other, so the user isn't asked again on this browser.
   *
   * The URL is built with `skipBrowserRedirect` and the provider checked
   * against the project's settings first: a provider that isn't enabled in
   * the Supabase dashboard otherwise dead-ends on a raw JSON error page.
   */
  const signInWithProvider = useCallback(async (provider, { returnTo } = {}) => {
    if (!supabase) throw notConfigured();
    const label = PROVIDER_LABELS[provider] || provider;

    const enabled = await fetchEnabledProviders();
    if (enabled && !enabled[provider]) {
      throw new Error(
        `${label} sign-in isn't turned on for this project yet. Enable it in Supabase → Authentication → Sign In / Providers.`
      );
    }

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/sign-in`,
        skipBrowserRedirect: true,
      },
    });
    if (error || !data?.url) {
      throw new Error(friendlyAuthError(error || new Error(`Couldn't start ${label} sign-in.`)));
    }

    try {
      if (returnTo) sessionStorage.setItem(RETURN_TO_KEY, returnTo);
    } catch {
      // storage blocked — the user just lands on the dashboard instead
    }
    window.location.assign(data.url);
  }, []);

  const signOut = useCallback(async () => {
    clearUserScopedStorage();
    setUserScope(null);
    if (!supabase) return;
    // "local" ends this browser's session without revoking the user's other
    // devices. If the network call fails the local session is still removed,
    // which is what the person clicking Sign out wants.
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error) console.warn("Sign-out did not reach Supabase:", error.message);
    setSession(null);
  }, []);

  const value = useMemo(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      configured: authConfigured,
      signIn,
      signUp,
      signInWithProvider,
      signOut,
      requestPasswordReset,
      updatePassword,
    }),
    [
      session,
      loading,
      signIn,
      signUp,
      signInWithProvider,
      signOut,
      requestPasswordReset,
      updatePassword,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
