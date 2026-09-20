/**
 * The `X-Client-Id` the server scopes saved interviews to.
 *
 * There are two sources, and which one is in play matters:
 *
 *   1. A signed-in user -> an id derived from their Supabase user id. History
 *      then belongs to the ACCOUNT: it follows them to a second device, and a
 *      different account signing in on this browser sees its own history rather
 *      than inheriting whatever the last person left here.
 *   2. Signed out (or Supabase unconfigured) -> a random per-browser id in
 *      localStorage, which is the original behaviour and keeps the app usable
 *      without auth at all.
 *
 * `AuthProvider` owns the switch and calls `setUserScope` on every auth
 * transition, synchronously, before anything can issue a request.
 *
 * This is still isolation, not authentication — the server takes the header at
 * face value, so anyone who can reach the API can name any owner. For a real
 * boundary the server has to verify the Supabase JWT and read the user id from
 * it; see "Authentication" in CLAUDE.md. What this fixes is the honest-user
 * case: two accounts on one laptop, or one account on two machines.
 */
const KEY = "mockInterview:clientId";
const VALID = /^[A-Za-z0-9_-]{8,64}$/;

let cached;
let userScoped = null;

function mint() {
  const raw =
    (typeof crypto !== "undefined" && crypto.randomUUID?.()) ||
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return raw.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
}

/**
 * Point the client id at a signed-in user, or back at the browser when `userId`
 * is null. Safe to call with the same value repeatedly.
 */
export function setUserScope(userId) {
  if (!userId || typeof userId !== "string") {
    userScoped = null;
    return;
  }
  // "u-" + the uuid with its dashes removed: 34 chars, inside the 8–64 the
  // server's header validator allows, and distinct from a minted browser id.
  const clean = userId.replace(/[^A-Za-z0-9]/g, "").slice(0, 60);
  userScoped = clean.length >= 6 ? `u-${clean}` : null;
}

/**
 * Forget this browser's anonymous id. Called on sign-out so the next person to
 * use the browser signed-out doesn't land on the previous one's history.
 */
export function resetBrowserId() {
  cached = undefined;
  try {
    localStorage.removeItem(KEY);
  } catch {
    // storage unavailable — the in-memory reset is the best we can do
  }
}

function browserId() {
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

export function getClientId() {
  return userScoped || browserId();
}
