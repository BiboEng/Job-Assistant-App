/**
 * A per-browser opaque id, persisted in localStorage. Sent as `X-Client-Id` on
 * every API call so the server can scope saved history to this browser — one
 * client can't list, open, or delete another's interviews.
 *
 * This is an isolation token, not a login: it identifies a browser, not a
 * person, and there's no password. For a real access boundary, run the server
 * with API_TOKEN set as well.
 */
const KEY = "mockInterview:clientId";
const VALID = /^[A-Za-z0-9_-]{8,64}$/;

let cached;

function mint() {
  const raw =
    (typeof crypto !== "undefined" && crypto.randomUUID?.()) ||
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return raw.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
}

export function getClientId() {
  if (cached) return cached;
  try {
    let id = localStorage.getItem(KEY);
    if (!id || !VALID.test(id)) {
      id = mint();
      localStorage.setItem(KEY, id);
    }
    cached = id;
  } catch {
    // Private mode / storage blocked: fall back to an id that lasts for this
    // page load only. History won't persist across reloads, which is the best
    // we can do without storage.
    cached = mint();
  }
  return cached;
}
