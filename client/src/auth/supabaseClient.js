import { createClient } from "@supabase/supabase-js";

/**
 * The single Supabase client. Values come from client/.env (exposed to the
 * bundle by `envPrefix` in vite.config.js) — never hardcode them.
 *
 * `null` when either is missing, so a checkout without Supabase configured
 * still builds and renders the public pages; the sign-in screen explains what's
 * missing instead of throwing at import time.
 *
 * Sessions persist in localStorage and the access token refreshes itself —
 * those are supabase-js defaults, spelled out because "stay signed in across a
 * refresh" depends on them. `detectSessionInUrl` picks up the tokens on the
 * return leg of an email-confirmation link.
 */
const url = (import.meta.env.SUPABASE_URL || "").trim();
const anonKey = (import.meta.env.SUPABASE_ANON_KEY || "").trim();

export const supabase = makeClient();

function makeClient() {
  if (!url || !anonKey) return null;
  try {
    return createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: "mockInterview:auth:v1",
      },
    });
  } catch (err) {
    // A malformed SUPABASE_URL throws synchronously; treat it as unconfigured
    // rather than blanking the whole app, public pages included.
    console.error("Supabase is misconfigured:", err.message);
    return null;
  }
}

export const authConfigured = supabase !== null;

/**
 * Which OAuth providers the Supabase project has switched on, from GoTrue's
 * public settings endpoint. Resolves `null` when it can't tell (offline,
 * unconfigured) so callers fall back to trying anyway.
 */
export async function fetchEnabledProviders() {
  if (!supabase) return null;
  try {
    const res = await fetch(`${url.replace(/\/+$/, "")}/auth/v1/settings`, {
      headers: { apikey: anonKey },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.external && typeof data.external === "object" ? data.external : null;
  } catch {
    return null;
  }
}
