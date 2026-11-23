/**
 * The words a user sees when something fails. Pure (no imports), so it can be
 * tested under plain node.
 *
 * The server already sends a readable `error` for anything it decides to
 * refuse; these cover the cases where nothing readable comes back: the
 * request never arrived, a proxy answered with an HTML error page (a Render
 * cold start does this), or a third party (Supabase) returned its own
 * internal wording.
 */

export const NETWORK_MESSAGE = "Can't reach Jobuddy right now. Check your connection and try again.";
export const TIMEOUT_MESSAGE = "This is taking longer than it should. Please try again.";
export const SIGNED_OUT_MESSAGE = "Your sign-in has expired. Sign in again to continue.";

/** A message for an HTTP failure that came back without one of its own. */
export function statusMessage(status) {
  if (status === 401) return SIGNED_OUT_MESSAGE;
  if (status === 403) return "You don't have access to that.";
  if (status === 404) return "We couldn't find that. It may have been deleted.";
  if (status === 408 || status === 504) return TIMEOUT_MESSAGE;
  if (status === 413) return "That's too much text to send at once. Shorten it and try again.";
  if (status === 429) return "You're going a little fast. Wait a moment and try again.";
  if (status >= 500) return "Jobuddy is having trouble right now. Please try again in a moment.";
  return "Something went wrong. Please try again.";
}

/**
 * The message for a failed HTTP response. A 401 always reads as an expired
 * sign-in: whatever the server's reason, that is what it means to the user.
 */
export function responseMessage(status, body) {
  if (status === 401) return SIGNED_OUT_MESSAGE;
  const own = typeof body?.error === "string" ? body.error.trim() : "";
  return own || statusMessage(status);
}

/**
 * Supabase/PostgREST errors carry Postgres wording ("new row violates check
 * constraint …", "JWT expired", "TypeError: Failed to fetch"). None of it is
 * meant for a user, so map the few that mean something and fall back to the
 * caller's plain sentence for the rest.
 */
export function supabaseMessage(error, fallback) {
  const msg = String(error?.message || "").toLowerCase();
  if (msg.includes("failed to fetch") || msg.includes("networkerror") || msg.includes("network request failed")) {
    return NETWORK_MESSAGE;
  }
  if (msg.includes("jwt") || error?.code === "PGRST301" || error?.status === 401) {
    return SIGNED_OUT_MESSAGE;
  }
  return fallback;
}
