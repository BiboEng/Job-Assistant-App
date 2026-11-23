/**
 * Waking the API before using it.
 *
 * The API runs on Render's free plan, which puts the server to sleep after ~15
 * minutes without traffic; the next request waits 30–60s while it starts. Two
 * things make that bearable:
 *
 *   1. `wakeServer()` is called once when the page loads (main.jsx), on every
 *      page including the landing page, so the server is usually starting
 *      while the visitor reads, signs in or types a job description.
 *   2. `request()` (client.js) calls `ensureAwake()` first. If nothing has
 *      answered recently, that waits on one shared `/api/health` ping before
 *      the real request starts its own timeout, so a cold start can't time a
 *      request out. If the ping takes longer than SHOW_AFTER_MS, `waking`
 *      turns true and `WakingNotice` tells the user what's happening.
 *
 * On an always-on host the ping answers in milliseconds and nothing shows.
 * No imports, no import.meta: the base URL is passed in, so this runs under
 * plain node for the tests.
 */

// Render sleeps after ~15 idle minutes; re-check a little before that.
export const AWAKE_FOR_MS = 10 * 60 * 1000;
// A warm server answers well within this, so the notice only shows for a real wake.
export const SHOW_AFTER_MS = 2500;
// A cold start is 30–60s; give it room before giving up and letting the
// request report whatever is wrong.
export const WAKE_TIMEOUT_MS = 90 * 1000;
// Between pings while the host's proxy answers 502/503 during the boot.
const RETRY_MS = 2000;

let lastAwakeAt = 0;
let pending = null;
let waking = false;
const listeners = new Set();

function setWaking(value) {
  if (waking === value) return;
  waking = value;
  for (const fn of listeners) fn();
}

/** Any response from the API (even an error status) means it's up. */
export function markAwake(now = Date.now()) {
  lastAwakeAt = now;
}

/** True while a wake has taken long enough to be worth telling the user about. */
export function isWaking() {
  return waking;
}

/** For useSyncExternalStore. */
export function subscribeWaking(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Resolves once the API has answered recently, or once a wake attempt has
 * finished (successfully or not: the caller's own request then surfaces any
 * real problem). Concurrent callers share one ping.
 */
export function ensureAwake(base = "", { fetchImpl = (...a) => fetch(...a), now = Date.now } = {}) {
  if (now() - lastAwakeAt < AWAKE_FOR_MS) return Promise.resolve();
  if (pending) return pending;

  pending = (async () => {
    const notice = setTimeout(() => setWaking(true), SHOW_AFTER_MS);
    const giveUpAt = now() + WAKE_TIMEOUT_MS;
    try {
      while (now() < giveUpAt) {
        const res = await fetchImpl(`${base}/api/health`, {
          cache: "no-store",
          signal: AbortSignal.timeout(Math.max(1000, giveUpAt - now())),
        });
        if (res.ok) {
          markAwake(now());
          return;
        }
        // A proxy's 502/503 while the server boots is not "awake": ask again
        // shortly. Any other status means it's up but unhappy, and the real
        // request will say why.
        if (res.status !== 502 && res.status !== 503 && res.status !== 504) return;
        await new Promise((r) => setTimeout(r, RETRY_MS));
      }
    } catch {
      // Unreachable or timed out: let the real request report it.
    } finally {
      clearTimeout(notice);
      setWaking(false);
      pending = null;
    }
  })();
  return pending;
}

/** Fire-and-forget warm-up on page load. */
export function wakeServer(base = "") {
  ensureAwake(base).catch(() => {});
}

/** Test hook. */
export function _resetWake() {
  lastAwakeAt = 0;
  pending = null;
  waking = false;
  listeners.clear();
}
