import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { USAGE_KINDS } from "../plans.js";
import { DATA_DIR } from "./dataDir.js";

/**
 * Per-user daily usage — interviews started, job searches run, Resume Builder
 * AI messages sent — counted against the plan's daily quotas.
 *
 * The day is the UTC calendar day, so every counter resets at 00:00 UTC.
 * Counters are kept in memory and mirrored to `<DATA_DIR>/usage.json`
 * (debounced, atomic temp-file + rename) so a restart or redeploy doesn't
 * hand everybody a fresh allowance mid-day. Only today's counts are kept.
 *
 * Quotas are RESERVED before the work and refunded if it fails: a check-then-
 * count-afterwards scheme lets two requests fired together both pass the
 * check, and counting a request whose model call failed would charge the user
 * for nothing. JS is single-threaded, so reserve's check-and-increment (after
 * the one-time load) can't interleave with another.
 *
 * Single-process, like the rest of the server's state.
 */

const FILE = join(DATA_DIR, "usage.json");
const TMP = `${FILE}.tmp`;
const WRITE_DELAY_MS = 500;

let state = null; // { day: "YYYY-MM-DD", counts: { [ownerId]: { [kind]: n } } }
let loading = null;
let writeTimer = null;
let writing = Promise.resolve();
let now = () => Date.now();

export function dayKey(ms = now()) {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Epoch ms of the next reset (the next 00:00 UTC). */
export function resetsAt(ms = now()) {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}

async function ensureLoaded() {
  if (state) return state;
  if (!loading) {
    loading = (async () => {
      try {
        const parsed = JSON.parse(await readFile(FILE, "utf8"));
        if (parsed && typeof parsed.day === "string" && parsed.counts && typeof parsed.counts === "object") {
          state = { day: parsed.day, counts: parsed.counts };
        }
      } catch (err) {
        if (err.code !== "ENOENT") console.error("[usage] could not read usage.json:", err.message);
      }
      if (!state) state = { day: dayKey(), counts: {} };
      return state;
    })();
  }
  return loading;
}

function rollover() {
  const today = dayKey();
  if (state.day !== today) {
    state = { day: today, counts: {} };
    scheduleWrite();
  }
}

function scheduleWrite() {
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    const snapshot = JSON.stringify(state);
    writing = writing
      .then(async () => {
        await mkdir(DATA_DIR, { recursive: true });
        await writeFile(TMP, snapshot, "utf8");
        await rename(TMP, FILE);
      })
      .catch((err) => console.error("[usage] could not write usage.json:", err.message));
  }, WRITE_DELAY_MS);
  writeTimer.unref?.();
}

function countsFor(ownerId) {
  if (!state.counts[ownerId]) state.counts[ownerId] = {};
  return state.counts[ownerId];
}

/**
 * Take one unit of `kind` for `ownerId` if `limit` allows it.
 * @param {string} ownerId
 * @param {"interviews"|"jobSearches"|"resumeMessages"} kind
 * @param {number|null} limit  null = unlimited (nothing is counted)
 * @returns {Promise<{ ok: boolean, used: number, limit: number|null, refund: () => void }>}
 */
export async function reserveUsage(ownerId, kind, limit) {
  const noop = () => {};
  if (!USAGE_KINDS.includes(kind)) throw new Error(`Unknown usage kind: ${kind}`);
  if (limit == null || !ownerId) return { ok: true, used: 0, limit: null, refund: noop };

  await ensureLoaded();
  rollover();
  const counts = countsFor(ownerId);
  const used = counts[kind] ?? 0;
  if (used >= limit) return { ok: false, used, limit, refund: noop };

  counts[kind] = used + 1;
  scheduleWrite();
  const day = state.day;
  let refunded = false;
  return {
    ok: true,
    used: used + 1,
    limit,
    // Only refunds into the same day it was taken from, and only once.
    refund() {
      if (refunded || !state || state.day !== day) return;
      refunded = true;
      const c = countsFor(ownerId);
      c[kind] = Math.max(0, (c[kind] ?? 1) - 1);
      scheduleWrite();
    },
  };
}

/** Today's counts for an owner: `{ interviews, jobSearches, resumeMessages }`. */
export async function usageFor(ownerId) {
  await ensureLoaded();
  rollover();
  const counts = (ownerId && state.counts[ownerId]) || {};
  return Object.fromEntries(USAGE_KINDS.map((k) => [k, counts[k] ?? 0]));
}

/** Test hooks. */
export function _setUsageClock(fn) {
  now = fn || (() => Date.now());
}
export async function _flushUsage() {
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
    const snapshot = JSON.stringify(state);
    writing = writing.then(async () => {
      await mkdir(DATA_DIR, { recursive: true });
      await writeFile(TMP, snapshot, "utf8");
      await rename(TMP, FILE);
    });
  }
  await writing;
}
export function _resetUsageMemory() {
  state = null;
  loading = null;
}
