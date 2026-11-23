import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { config } from "../config.js";
import { DATA_DIR } from "./dataDir.js";
import { buildRecord, summarize } from "./historyRecord.js";

/**
 * The flat-file history store, used when the server can't reach Supabase as
 * the service role (local development, tests) or the interview_history table
 * doesn't exist yet. See history.service.js for how the store is chosen.
 *
 * Flat-file interview history. One JSON array in <dataDir>/interviews.json.
 * Loaded into memory once, then every mutation goes through a serial queue and
 * an atomic write (temp file + rename) so concurrent saves can't corrupt it.
 *
 * Records are scoped to an `ownerId` (the caller's client id) so one browser
 * can't list, open, or delete another's interviews.
 *
 * NOTE: this is process-local and lives on the local disk. It does not survive
 * an ephemeral filesystem (many PaaS hosts) unless DATA_DIR points at a mounted
 * volume, and it can't be shared across instances — which is why a deployed
 * server uses history.supabase.js instead.
 */

const DATA_FILE = join(DATA_DIR, "interviews.json");
const TMP_FILE = `${DATA_FILE}.tmp`;

/** @type {Array<object>|null} */
let cache = null;
let writeQueue = Promise.resolve();

async function ensureLoaded() {
  if (cache) return cache;

  await mkdir(dirname(DATA_FILE), { recursive: true });

  try {
    const raw = await readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    cache = Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if (err.code === "ENOENT") {
      cache = [];
    } else {
      // Corrupt / unreadable file: preserve it for inspection, start fresh.
      console.error("[history] could not read interviews.json:", err.message);
      try {
        await rename(DATA_FILE, `${DATA_FILE}.corrupt-${Date.now()}`);
      } catch {
        /* ignore */
      }
      cache = [];
    }
  }
  return cache;
}

function enqueueWrite(fn) {
  const run = writeQueue.then(fn, fn);
  writeQueue = run.catch(() => {});
  return run;
}

async function persist() {
  await writeFile(TMP_FILE, JSON.stringify(cache, null, 2), "utf8");
  await rename(TMP_FILE, DATA_FILE);
}

/** Loads the file now, so a corrupt one is surfaced on boot rather than on first request. */
export async function ready() {
  await ensureLoaded();
}

/**
 * Lightweight list for the home screen, newest first, scoped to one owner.
 * `limit` (the plan's visible history) keeps only the newest N; older records
 * stay stored — a downgrade hides them, it never deletes them.
 */
export async function listInterviews(ownerId, { limit = null } = {}) {
  if (!ownerId) return [];
  const all = await ensureLoaded();
  const mine = all
    .filter((it) => it.ownerId === ownerId)
    .sort((a, b) => b.createdAt - a.createdAt);
  return (limit == null ? mine : mine.slice(0, Math.max(0, limit)))
    .map(summarize);
}

/** How many interviews an owner has stored (visible or not). */
export async function countInterviews(ownerId) {
  if (!ownerId) return 0;
  const all = await ensureLoaded();
  return all.filter((it) => it.ownerId === ownerId).length;
}

/**
 * Is this record among the owner's newest `limit`? (`limit` null = all are.)
 * Used to keep a hidden interview hidden when it's opened by id.
 */
export async function isWithinNewest(id, ownerId, limit) {
  if (limit == null) return true;
  const all = await ensureLoaded();
  return all
    .filter((it) => it.ownerId === ownerId)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, Math.max(0, limit))
    .some((it) => it.id === id);
}

/** Full record by id, or null if missing or owned by someone else. */
export async function getInterview(id, ownerId) {
  if (!ownerId) return null;
  const all = await ensureLoaded();
  const record = all.find((it) => it.id === id);
  if (!record || record.ownerId !== ownerId) return null;
  return record;
}

/** Append a completed interview and return the stored record. */
export async function saveInterview(input) {
  await ensureLoaded();
  const record = buildRecord(input);
  const { ownerId } = record;

  await enqueueWrite(async () => {
    cache.push(record);
    enforceOwnerCap(ownerId);
    await persist();
  });

  return record;
}

/** Keep only the newest N records for an owner. */
function enforceOwnerCap(ownerId) {
  const max = config.limits.maxInterviewsPerOwner;
  if (!ownerId || max <= 0) return;
  const mine = cache
    .map((it, idx) => ({ it, idx }))
    .filter(({ it }) => it.ownerId === ownerId)
    .sort((a, b) => b.it.createdAt - a.it.createdAt);
  const drop = new Set(mine.slice(max).map(({ idx }) => idx));
  if (drop.size) cache = cache.filter((_, idx) => !drop.has(idx));
}

/** Remove a stored interview owned by `ownerId`. Returns true if one was deleted. */
export async function deleteInterview(id, ownerId) {
  await ensureLoaded();

  if (!ownerId) return false;

  let removed = false;
  await enqueueWrite(async () => {
    const idx = cache.findIndex((it) => it.id === id && it.ownerId === ownerId);
    if (idx === -1) return;
    cache.splice(idx, 1);
    removed = true;
    await persist();
  });

  return removed;
}

/**
 * Every full record an owner has, oldest first — for the Progress section,
 * which needs job descriptions (to name roles) and feedback (for themes).
 * Callers must treat the records as read-only; mutations go through the write
 * queue below.
 */
export async function listOwnerRecords(ownerId) {
  if (!ownerId) return [];
  const all = await ensureLoaded();
  return all
    .filter((it) => it.ownerId === ownerId)
    .sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * Stamps role labels onto an owner's records: `rolesById` maps interview id →
 * `{ title, source, labelledAt }`. Records that belong to someone else, or
 * were deleted meanwhile, are skipped. Returns how many were updated.
 * @param {string} ownerId
 * @param {Map<string, { title: string, source: string, labelledAt: number }>} rolesById
 */
export async function setInterviewRoles(ownerId, rolesById) {
  await ensureLoaded();
  if (!ownerId || !rolesById?.size) return 0;

  let updated = 0;
  await enqueueWrite(async () => {
    for (const record of cache) {
      if (record.ownerId !== ownerId) continue;
      const role = rolesById.get(record.id);
      if (!role) continue;
      record.role = role;
      updated += 1;
    }
    if (updated) await persist();
  });
  return updated;
}
