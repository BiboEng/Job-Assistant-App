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

/** Append a completed interview and return the stored record. */
export async function saveInterview({
  jobDescription,
  qaPairs,
  feedback,
  totalQuestions,
  ownerId = null,
}) {
  await ensureLoaded();

  const record = {
    id: randomUUID(),
    ownerId,
    createdAt: Date.now(),
    jobDescription,
    totalQuestions: totalQuestions ?? (qaPairs ?? []).length,
    qaPairs: (qaPairs ?? []).map((p) => ({
      questionNumber: p.questionNumber,
      question: p.question,
      answer: p.answer || "",
      timeLimitSeconds: p.timeLimitSeconds ?? null,
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
