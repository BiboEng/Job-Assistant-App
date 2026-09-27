import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname, join, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";

/**
 * Flat-file interview history. One JSON array in <dataDir>/interviews.json.
 * Loaded into memory once, then every mutation goes through a serial queue and
 * an atomic write (temp file + rename) so concurrent saves can't corrupt it.
 *
 * Records are scoped to an `ownerId` (the caller's client id) so one browser
 * can't list, open, or delete another's interviews.
 *
 * NOTE: this is process-local and lives on the local disk. It does not survive
 * an ephemeral filesystem (many PaaS hosts) unless DATA_DIR points at a mounted
 * volume, and it can't be shared across instances. Swap this module for a
 * DB-backed one to deploy for real — the controllers don't need to change.
 */

const DEFAULT_DIR = fileURLToPath(new URL("../../data", import.meta.url));
const DATA_DIR = config.dataDir
  ? isAbsolute(config.dataDir)
    ? config.dataDir
    : resolve(process.cwd(), config.dataDir)
  : DEFAULT_DIR;
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

/** Called on boot so a corrupt file is surfaced early rather than on first request. */
export async function ensureHistoryReady() {
  await ensureLoaded();
}

function titleOf(jd) {
  const firstLine =
    jd.split("\n").map((l) => l.trim()).find(Boolean) || jd.trim();
  return firstLine.slice(0, 80);
}

/**
 * The body of the posting, minus the line already used as the title — starting
 * at character zero made every history card read "<role> / <role> We're looking
 * for…". Falls back to the whole text for a single-line job description.
 */
function snippetOf(jd) {
  const lines = jd.split("\n");
  const firstIndex = lines.findIndex((l) => l.trim());
  const rest = firstIndex === -1 ? "" : lines.slice(firstIndex + 1).join(" ");
  const body = rest.trim() || jd.trim();
  return body.replace(/\s+/g, " ").slice(0, 140);
}

/** Lightweight list for the home screen, newest first, scoped to one owner. */
export async function listInterviews(ownerId) {
  if (!ownerId) return [];
  const all = await ensureLoaded();
  return all
    .filter((it) => it.ownerId === ownerId)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((it) => ({
      id: it.id,
      createdAt: it.createdAt,
      title: titleOf(it.jobDescription),
      snippet: snippetOf(it.jobDescription),
      overallScore: it.feedback?.overallScore ?? 0,
      mode: it.mode ?? null,
      totalQuestions: it.totalQuestions ?? it.qaPairs?.length ?? 0,
      answeredCount: (it.qaPairs ?? []).filter((p) => p.answer && p.answer.trim())
        .length,
    }));
}

/** Full record by id, or null if missing or owned by someone else. */
export async function getInterview(id, ownerId) {
  if (!ownerId) return null;
  const all = await ensureLoaded();
  const record = all.find((it) => it.id === id);
  if (!record || record.ownerId !== ownerId) return null;
  return record;
}

/**
 * Append a completed interview and return the stored record.
 *
 * `mode` ("type" | "speak") and `focus` are kept so a saved interview can say
 * how it was taken, and each answer keeps its speak-mode `delivery` metrics
 * (null in type mode). Those were validated and clamped by normalizeDelivery
 * on the way in, so they're stored as-is.
 */
export async function saveInterview({
  jobDescription,
  qaPairs,
  feedback,
  totalQuestions,
  mode = null,
  focus = null,
  ownerId = null,
}) {
  await ensureLoaded();

  const record = {
    id: randomUUID(),
    ownerId,
    createdAt: Date.now(),
    jobDescription,
    mode,
    focus,
    totalQuestions: totalQuestions ?? (qaPairs ?? []).length,
    qaPairs: (qaPairs ?? []).map((p) => ({
      questionNumber: p.questionNumber,
      question: p.question,
      answer: p.answer || "",
      timeLimitSeconds: p.timeLimitSeconds ?? null,
      delivery: p.delivery ?? null,
    })),
    feedback,
  };

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
