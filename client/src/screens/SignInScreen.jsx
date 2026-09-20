import { useEffect, useId, useRef, useState } from "react";
import { Link, Navigate, useLocation, useSearchParams } from "react-router";
import PublicHeader from "../components/PublicHeader.jsx";
import Icon from "../components/Icon.jsx";
import { useAuth, takeAuthReturnTo } from "../auth/AuthProvider.jsx";
import { PATHS } from "../routes.js";
import styles from "./SignInScreen.module.css";

/**
 * /sign-in — email + password, with sign-up on the same page.
 *
 * The mode lives in the query string (`?mode=sign-up`) so the landing page's
 * "Create an account" button can deep-link straight to the sign-up form, and
 * switching modes is shareable and survives a refresh.
 *
 * There's no navigate-on-success call: once Supabase reports a session,
 * AuthProvider's `user` becomes non-null and this screen renders a <Navigate>.
 * That one path covers a normal sign-in, a sign-up on a project without email
 * confirmation, the return leg of a confirmation link, and a visitor who was
 * already signed in, and the return leg of a Google / GitHub redirect.
 *
 * Google and GitHub go through Supabase OAuth. They leave the page, so the
 * deep-link destination is stashed in sessionStorage (takeAuthReturnTo) and
 * a provider-side failure comes back as `error_description` in the URL.
 */

const MIN_PASSWORD = 8;

const PROVIDERS = [
  { id: "google", label: "Google" },
  { id: "github", label: "GitHub" },
];

/**
 * An OAuth failure comes back on the redirect URL — in the hash (implicit
 * flow) or the query (PKCE) — as error_description. Read it once, then strip
 * it so a refresh doesn't show a stale error.
 */
function takeOAuthError() {
  if (typeof window === "undefined") return "";
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const query = new URLSearchParams(window.location.search);
  const raw =
    hash.get("error_description") ||
    query.get("error_description") ||
    hash.get("error") ||
    query.get("error");
  if (!raw) return "";
  for (const key of ["error", "error_code", "error_description"]) query.delete(key);
  const qs = query.toString();
  window.history.replaceState(
    window.history.state,
    "",
    `${window.location.pathname}${qs ? `?${qs}` : ""}`
  );
  const text = raw; // URLSearchParams has already decoded "+" and %-escapes
  return `Couldn't sign you in: ${text.charAt(0).toLowerCase()}${text.slice(1)}`;
}

/**
 * Read ONCE per page load, at module scope.
 *
 * This used to be a `useState` lazy initializer, which looks equivalent and
 * isn't: `takeOAuthError` consumes the hash, and StrictMode mounts the screen
 * twice in dev. The first mount read the error and cleaned the URL; the second
 * re-ran the initializer against the now-empty URL and set the error to "". The
 * result was a provider failure that vanished completely — no message, no hash,
 * just the sign-in form again, which is indistinguishable from "nothing
 * happened" and made the whole flow undiagnosable.
 *
 * Module scope runs once per document, so both mounts see the same value.
 */
const INITIAL_OAUTH_ERROR = takeOAuthError();

/** Only same-app paths are honoured as a post-sign-in destination. */
function safeFrom(from) {
  if (typeof from !== "string") return PATHS.dashboard;
  if (!from.startsWith("/") || from.startsWith("//")) return PATHS.dashboard;
  if (from.startsWith(PATHS.signIn)) return PATHS.dashboard;
  return from;
}

const MODES = new Set(["sign-in", "sign-up", "forgot"]);

export default function SignInScreen() {
  const {
    user,
    loading,
    configured,
    signIn,
    signUp,
    signInWithProvider,
    requestPasswordReset,
  } = useAuth();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const raw = params.get("mode");
  const mode = MODES.has(raw) ? raw : "sign-in";
  const isSignUp = mode === "sign-up";
  const isForgot = mode === "forgot";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(INITIAL_OAUTH_ERROR);
  const [pendingProvider, setPendingProvider] = useState(null);
  // Read once at mount: set just before leaving for Google/GitHub.
  const [storedReturnTo] = useState(takeAuthReturnTo);
  const [notice, setNotice] = useState("");
  const emailRef = useRef(null);
  const ids = useId();
  const emailId = `${ids}-email`;
  const passwordId = `${ids}-password`;
  const confirmId = `${ids}-confirm`;
  const hintId = `${ids}-hint`;

  // Clear stale feedback when switching between the two forms.
  //
  // Compare the actual value rather than counting runs. A "skip the first run"
  // ref does not survive contact with StrictMode: the effect runs on mount
  // (flag flips), is cleaned up, then runs AGAIN on the dev remount — where the
  // flag is now false, so it reads as a genuine mode change and wipes the
  // error. Combined with `takeOAuthError` having already stripped the hash,
  // that made every OAuth failure vanish without trace: clean URL, no message,
  // just the form again. Keyed on the value, a remount is a no-op.
  const prevModeRef = useRef(mode);
  useEffect(() => {
    if (prevModeRef.current === mode) return;
    prevModeRef.current = mode;
    setError("");
    setConfirm("");
  }, [mode]);

  if (user) {
    return <Navigate to={safeFrom(location.state?.from ?? storedReturnTo)} replace />;
  }

  function switchMode(next, { keepNotice = false } = {}) {
    if (!keepNotice) setNotice("");
    const nextParams = new URLSearchParams(params);
    if (next === "sign-in") nextParams.delete("mode");
    else nextParams.set("mode", next);
    // Replace, and carry the router state along, so a deep-link destination
    // isn't lost by toggling forms.
    setParams(nextParams, { replace: true, state: location.state });
    emailRef.current?.focus();
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting) return;
    setError("");
    setNotice("");

    const trimmedEmail = email.trim();

    // Forgot-password asks for the address alone.
    if (isForgot) {
      if (!trimmedEmail) {
        setError("Enter the email address on your account.");
        return;
      }
      setSubmitting(true);
      try {
        await requestPasswordReset(trimmedEmail);
        // Deliberately the same message whether or not an account exists —
        // Supabase won't say, and neither should we.
        setNotice(
          `If ${trimmedEmail} has an account, a link to set a new password is on its way. It expires in an hour.`
        );
      } catch (err) {
        setError(err.message);
      } finally {
        setSubmitting(false);
      }
      return;
    }

    if (!trimmedEmail || !password) {
      setError("Enter your email and password.");
      return;
    }
    if (isSignUp) {
      if (password.length < MIN_PASSWORD) {
        setError(`Use a password of at least ${MIN_PASSWORD} characters.`);
        return;
      }
      if (password !== confirm) {
        setError("The two passwords don't match.");
        return;
      }
    }

    setSubmitting(true);
    try {
      if (isSignUp) {
        const { needsConfirmation } = await signUp(trimmedEmail, password);
        if (needsConfirmation) {
          setPassword("");
          setConfirm("");
          setNotice(
            `Check ${trimmedEmail} for a confirmation link. Once you've followed it, sign in here.`
          );
          switchMode("sign-in", { keepNotice: true });
        }
      } else {
        await signIn(trimmedEmail, password);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleProvider(provider) {
    if (pendingProvider) return;
    setError("");
    setNotice("");
    setPendingProvider(provider);
    try {
      await signInWithProvider(provider, { returnTo: location.state?.from });
      // On success the page is navigating away — keep the button busy.
    } catch (err) {
      setError(err.message);
      setPendingProvider(null);
    }
  }

  const disabled = submitting || !configured || Boolean(pendingProvider);

  return (
    <div className="public-site">
      <PublicHeader />

      <main id="main-content" tabIndex={-1} className={`app-shell app-shell--public ${styles.page}`}>
        <div className={styles.card}>
          <div className={styles.head}>
            <span className={styles.icon} aria-hidden="true">
              <Icon name="lock" size={20} />
            </span>
            <h1 className={styles.title}>
              {isForgot
                ? "Reset your password"
                : isSignUp
                ? "Create your account"
                : "Welcome back"}
            </h1>
            <p className={styles.subtitle}>
              {isForgot
                ? "We'll email you a link to set a new one."
                : isSignUp
                ? "Save your practice history and pick up where you left off."
                : "Sign in to continue to your dashboard."}
            </p>
          </div>

          {/* Two tabs, but it's one form — the switch is a mode, not a page.
              Forgot-password is reached from the link below, not from here, so
              it isn't a third tab. */}
          {!isForgot && (
            <div
              className={styles.switch}
              role="group"
              aria-label="Choose sign in or sign up"
            >
              <button
                type="button"
                className={`${styles.switchItem} ${!isSignUp ? styles.switchActive : ""}`}
                aria-pressed={!isSignUp}
                onClick={() => switchMode("sign-in")}
              >
                Sign in
              </button>
              <button
                type="button"
                className={`${styles.switchItem} ${isSignUp ? styles.switchActive : ""}`}
                aria-pressed={isSignUp}
                onClick={() => switchMode("sign-up")}
              >
                Sign up
              </button>
            </div>
          )}

          {!configured && (
            <div className="warn-banner" role="alert">
              <Icon name="alert" size={16} />
              <span className={styles.bannerText}>
                Sign-in isn&apos;t configured. Set <code>SUPABASE_URL</code> and{" "}
                <code>SUPABASE_ANON_KEY</code> in <code>client/.env</code>, then restart
                the dev server.
              </span>
            </div>
          )}

          {notice && (
            <div className="info-banner" role="status">
              <Icon name="mail" size={16} />
              <span className={styles.bannerText}>{notice}</span>
            </div>
          )}

          {error && (
            <div className="error-banner" role="alert">
              <Icon name="alert" size={16} />
              <span className={styles.bannerText}>{error}</span>
            </div>
          )}

          {/* A password reset is about an email/password account, so the OAuth
              buttons would only be a distraction here. */}
          {!isForgot && (
            <>
              <div className={styles.providers}>
                {PROVIDERS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={styles.providerBtn}
                    onClick={() => handleProvider(p.id)}
                    disabled={disabled || loading}
                  >
                    <ProviderLogo provider={p.id} />
                    {pendingProvider === p.id
                      ? `Redirecting to ${p.label}…`
                      : `Continue with ${p.label}`}
                  </button>
                ))}
              </div>

              <div className={styles.divider} role="separator">
                <span>or use your email</span>
              </div>
            </>
          )}

          <form className={styles.form} onSubmit={handleSubmit} noValidate>
            <div className={styles.field}>
              <label className={styles.label} htmlFor={emailId}>
                Email
              </label>
              <input
                id={emailId}
                ref={emailRef}
                className={styles.input}
                type="email"
                name="email"
                autoComplete="email"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={disabled}
                required
              />
            </div>

            {!isForgot && (
            <div className={styles.field}>
              <span className={styles.labelRow}>
                <label className={styles.label} htmlFor={passwordId}>
                  Password
                </label>
                {isSignUp ? (
                  <button
                    type="button"
                    className={styles.reveal}
                    onClick={() => setShowPassword((v) => !v)}
                    aria-pressed={showPassword}
                    aria-controls={passwordId}
                    disabled={disabled}
                  >
                    {showPassword ? "Hide" : "Show"}
                  </button>
                ) : (
                  <span className={styles.labelActions}>
                    <button
                      type="button"
                      className={styles.reveal}
                      onClick={() => setShowPassword((v) => !v)}
                      aria-pressed={showPassword}
                      aria-controls={passwordId}
                      disabled={disabled}
                    >
                      {showPassword ? "Hide" : "Show"}
                    </button>
                    {/* Without this there is no way back into an account at
                        all — there was no reset flow of any kind before. */}
                    <button
                      type="button"
                      className={styles.reveal}
                      onClick={() => switchMode("forgot")}
                      disabled={disabled}
                    >
                      Forgot?
                    </button>
                  </span>
                )}
              </span>
              <input
                id={passwordId}
                className={styles.input}
                type={showPassword ? "text" : "password"}
                name="password"
                autoComplete={isSignUp ? "new-password" : "current-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={disabled}
                minLength={isSignUp ? MIN_PASSWORD : undefined}
                aria-describedby={isSignUp ? hintId : undefined}
                required
              />
              {isSignUp && (
                <span id={hintId} className={styles.hint}>
                  At least {MIN_PASSWORD} characters.
                </span>
              )}
            </div>
            )}

            {isSignUp && (
              <div className={styles.field}>
                <label className={styles.label} htmlFor={confirmId}>
                  Confirm password
                </label>
                <input
                  id={confirmId}
                  className={styles.input}
                  type={showPassword ? "text" : "password"}
                  name="confirm-password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  disabled={disabled}
                  required
                />
              </div>
            )}

            <button type="submit" className={`btn-primary ${styles.submit}`} disabled={disabled}>
              {submitting
                ? isForgot
                  ? "Sending…"
                  : isSignUp
                  ? "Creating account…"
                  : "Signing in…"
                : isForgot
                ? "Email me a reset link"
                : isSignUp
                ? "Create account"
                : "Sign in"}
            </button>
          </form>

          <p className={styles.alt}>
            {isForgot ? (
              <button
                type="button"
                className="link-btn"
                onClick={() => switchMode("sign-in")}
              >
                Back to sign in
              </button>
            ) : (
              <>
                {isSignUp ? "Already have an account? " : "New here? "}
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => switchMode(isSignUp ? "sign-in" : "sign-up")}
                >
                  {isSignUp ? "Sign in" : "Create an account"}
                </button>
              </>
            )}
          </p>
        </div>

        <p className={styles.back}>
          <Link to={PATHS.home} className={styles.backLink}>
            <Icon name="arrowLeft" size={15} />
            Back to home
          </Link>
        </p>
      </main>
    </div>
  );
}

/**
 * Provider marks. Google's "G" keeps its four brand colours (its sign-in
 * guidelines require the unaltered mark); GitHub's is monochrome and follows
 * the text colour, so it works in both themes.
 */
function ProviderLogo({ provider }) {
  if (provider === "google") {
    return (
      <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
        <path
          fill="#FFC107"
          d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.6-.4-3.9z"
        />
        <path
          fill="#FF3D00"
          d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
        />
        <path
          fill="#4CAF50"
          d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"
        />
        <path
          fill="#1976D2"
          d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z"
        />
      </svg>
    );
  }
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true" focusable="false" fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}
