// Shared UI constants. Keep the length limits in sync with server/src/config.js.
export const MIN_JD_LENGTH = 30;
export const MAX_JD_LENGTH = 8000;
export const MAX_ANSWER_LENGTH = 5000;

// Client-side request timeout. Kept comfortably above the server's worst case
// (one upstream call ~30s; feedback may retry once on an unparseable response)
// so a genuine server error surfaces before the client gives up.
export const REQUEST_TIMEOUT_MS = 60000;

// Where the in-progress interview is cached so a refresh doesn't lose it.
export const STORAGE_KEY = "mockInterview:v1";

// Seed from a random offset so ids minted after a reload can't collide with
// ids restored from sessionStorage in the same millisecond.
let counter = Math.floor(Math.random() * 1e6);
/** Stable-enough id for list keys / messages. */
export function nextId() {
  counter += 1;
  return `${Date.now().toString(36)}-${counter}`;
}
