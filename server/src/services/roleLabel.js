/**
 * Role labels for the Progress section — pure, no I/O, unit-tested.
 *
 * Grouping happens in two layers:
 *
 *   1. A model names each interview's role once ("Frontend Engineer"), shown
 *      the titles the user already has so it reuses one for the same kind of
 *      job. That lives in progress.service.js; the title is stored on the
 *      record as `role: { title, source: "model" }`.
 *   2. `roleKey` — this module — canonicalises a title into the key interviews
 *      are actually grouped by. The model's wording drifts between calls
 *      ("Front-End Engineer" one day, "Frontend Developer" the next), so the
 *      grouping must not depend on it being character-for-character stable.
 *
 * The key is computed at read time, never stored, so improving these rules
 * regroups existing history without a migration.
 *
 * An interview the model hasn't labelled yet (legacy history, or a failed
 * call) falls back to `heuristicTitle` over the job description's first line,
 * which goes through the same `roleKey`.
 */

import { normalizeRubric } from "../rubric.js";

/** Words that say how senior a role is, not what it is. */
const SENIORITY = new Set([
  "senior", "sr", "junior", "jr", "lead", "staff", "principal", "intern",
  "internship", "entry", "level", "mid", "associate", "trainee", "graduate",
  "grad", "apprentice", "experienced",
]);

/** Roman numerals and bare level digits ("Engineer II", "Analyst 3"). */
const LEVEL = /^(i{1,3}|iv|v|[1-5])$/;

/**
 * Single-token synonyms. Kept deliberately small: it only needs to catch the
 * wordings that mean the same job everywhere. Anything subtler ("UI Engineer"
 * vs "Frontend Engineer") is the model's job, via the existing-titles hint.
 */
const TOKEN_SYNONYMS = {
  developer: ["engineer"],
  dev: ["engineer"],
  programmer: ["engineer"],
  coder: ["engineer"],
  eng: ["engineer"],
  engineering: ["engineer"],
  swe: ["software", "engineer"],
  sde: ["software", "engineer"],
  sre: ["site", "reliability", "engineer"],
  pm: ["product", "manager"],
  mgr: ["manager"],
  ml: ["machine", "learning"],
  js: ["javascript"],
};

/** Two-word spellings of one word: "front end", "front-end" → "frontend". */
const COMPOUNDS = [
  [/\bfront\s+end\b/g, "frontend"],
  [/\bback\s+end\b/g, "backend"],
  [/\bfull\s+stack\b/g, "fullstack"],
  [/\bdev\s+ops\b/g, "devops"],
  [/\bdev\s+sec\s+ops\b/g, "devsecops"],
  [/\bdata\s+base\b/g, "database"],
];

const MAX_TITLE_LENGTH = 60;

/**
 * Canonical grouping key for a role title.
 *   "Senior Front-End Developer (Remote)" → "frontend engineer"
 *   "Frontend Engineer"                    → "frontend engineer"
 *   "Data Analyst" / "Data Scientist"      → stay distinct
 * Never returns an empty string.
 * @param {unknown} title
 * @returns {string}
 */
export function roleKey(title) {
  let s = String(title ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ") // "(Remote)", "[Contract]"
    .replace(/&/g, " and ")
    .replace(/[-_/]+/g, " ");

  for (const [pattern, replacement] of COMPOUNDS) s = s.replace(pattern, replacement);

  // Keep + and # so "C++" and "C#" survive; everything else is a separator.
  s = s.replace(/[^a-z0-9+#\s]/g, " ");

  const out = [];
  for (const raw of s.split(/\s+/)) {
    if (!raw || SENIORITY.has(raw) || LEVEL.test(raw)) continue;
    const expansion = TOKEN_SYNONYMS[raw] ?? [raw];
    // "Software Engineer SWE": the abbreviation adds nothing already said.
    if (expansion.length > 1 && expansion.every((t) => out.includes(t))) continue;
    for (const token of expansion) {
      // "Software Engineer (SWE)" and friends shouldn't read "engineer engineer".
      if (out[out.length - 1] !== token) out.push(token);
    }
  }

  return out.join(" ") || "role";
}

/**
 * Cleans a model-returned title into something safe to store and show:
 * a single line, no wrapping quotes, bounded length. Null if nothing usable.
 * @param {unknown} raw
 * @returns {string|null}
 */
export function cleanRoleTitle(raw) {
  if (typeof raw !== "string") return null;
  const s = raw
    .replace(/[\r\n\t]+/g, " ")
    .replace(/^["'`\s]+|["'`\s.]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TITLE_LENGTH)
    .trim();
  return s || null;
}

/**
 * Best-effort role title from a job description, without a model: the first
 * non-empty line, minus a "Job title:" prefix, a trailing "— Team" / "at
 * Company" / "| Location", bracketed asides and leading seniority words.
 *   "Senior Frontend Engineer — Design Systems" → "Frontend Engineer"
 * @param {unknown} jobDescription
 * @returns {string}
 */
export function heuristicTitle(jobDescription) {
  const firstLine =
    String(jobDescription ?? "")
      .split("\n")
      .map((l) => l.trim())
      .find(Boolean) ?? "";

  let s = firstLine
    .replace(/^(job\s+)?(title|role|position)\s*[:\-–—]\s*/i, "")
    .split(/\s+[—–|]\s+|\s+-\s+|\s+@\s+|\s+at\s+|,|;/i)[0]
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Drop leading seniority words so the fallback label matches what the model
  // would have called it ("Frontend Engineer", not "Senior Frontend Engineer").
  const words = s.split(" ");
  while (words.length > 1 && SENIORITY.has(words[0].toLowerCase().replace(/\.$/, ""))) {
    words.shift();
  }
  s = words.join(" ");

  return cleanRoleTitle(s) ?? "Untitled role";
}

/**
 * Stored label sources that count as settled. "model" is a title the model
 * gave; "fallback" is the first-line heuristic, stamped when a labelling call
 * succeeded but skipped that posting — stored so it isn't re-sent on every
 * visit. Anything else (no label yet) is computed on the fly as "heuristic"
 * and retried.
 */
const SETTLED = new Set(["model", "fallback"]);

/** True when an interview already carries a settled role label. */
export function isLabelled(record) {
  return Boolean(cleanRoleTitle(record?.role?.title) && SETTLED.has(record.role.source));
}

/**
 * The role an interview counts under: its stored label when it has one, the
 * first-line heuristic otherwise.
 * @param {{ role?: { title?: string, source?: string }, jobDescription?: string }} record
 * @returns {{ title: string, source: "model" | "fallback" | "heuristic" }}
 */
export function effectiveRole(record) {
  if (isLabelled(record)) {
    return { title: cleanRoleTitle(record.role.title), source: record.role.source };
  }
  return { title: heuristicTitle(record?.jobDescription), source: "heuristic" };
}

/**
 * The name a group is shown under: the most common model title among its
 * interviews (ties → the most recent), falling back to heuristic titles only
 * when no interview in the group has a model label yet.
 * @param {Array<{ title: string, source: string, createdAt: number }>} entries
 */
export function displayTitle(entries) {
  const model = entries.filter((e) => e.source === "model");
  const pool = model.length ? model : entries;
  const tally = new Map();
  for (const e of pool) {
    const t = tally.get(e.title) ?? { count: 0, latest: 0 };
    t.count += 1;
    t.latest = Math.max(t.latest, e.createdAt ?? 0);
    tally.set(e.title, t);
  }
  let best = null;
  for (const [title, t] of tally) {
    if (!best || t.count > best.count || (t.count === best.count && t.latest > best.latest)) {
      best = { title, ...t };
    }
  }
  return best?.title ?? "Untitled role";
}

/**
 * Groups one owner's saved interviews by role, for GET /api/progress.
 * Each group's interviews are chronological (oldest first — the order a trend
 * line reads in); groups are ordered by their most recent interview.
 *
 * Deliberately carries nothing but ids, dates, titles and scores: no answers,
 * no feedback text, and none of speak mode's delivery metrics.
 *
 * @param {Array<object>} records full history records
 */
export function groupByRole(records) {
  const groups = new Map();

  for (const record of records ?? []) {
    if (!record || typeof record.id !== "string") continue;
    const role = effectiveRole(record);
    const key = roleKey(role.title);
    const entry = {
      id: record.id,
      createdAt: Number(record.createdAt) || 0,
      overallScore: clampScore(record.feedback?.overallScore),
      jobTitle: heuristicTitleLine(record.jobDescription),
      // Four 0–10 numbers, or null for interviews saved before the rubric
      // existed. Numbers only — no feedback text reaches this payload.
      rubric: normalizeRubric(record.feedback?.rubric),
      mode: record.mode === "speak" || record.mode === "type" ? record.mode : null,
      // The format, so Progress can say what "Practice again" will repeat.
      focus: typeof record.focus === "string" ? record.focus.slice(0, 40) : null,
      totalQuestions: clampCount(record.totalQuestions ?? record.qaPairs?.length),
      title: role.title,
      source: role.source,
    };
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }

  return [...groups.entries()]
    .map(([key, entries]) => {
      entries.sort((a, b) => a.createdAt - b.createdAt);
      const scores = entries.map((e) => e.overallScore);
      const first = scores[0];
      const latest = scores[scores.length - 1];
      return {
        key,
        title: displayTitle(entries),
        count: entries.length,
        averageScore: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
        bestScore: Math.max(...scores),
        latestScore: latest,
        // Change from the first interview to the latest. Null with one data
        // point — a single interview has no trend, and 0 would claim one.
        change: entries.length > 1 ? latest - first : null,
        latestAt: entries[entries.length - 1].createdAt,
        interviews: entries.map(
          ({ id, createdAt, overallScore, jobTitle, rubric, mode, focus, totalQuestions }) => ({
            id,
            createdAt,
            overallScore,
            jobTitle,
            rubric,
            mode,
            focus,
            totalQuestions,
          })
        ),
      };
    })
    .sort((a, b) => b.latestAt - a.latestAt);
}

function clampCount(n) {
  const v = Math.round(Number(n));
  return Number.isFinite(v) && v > 0 ? Math.min(50, v) : null;
}

function clampScore(n) {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : 0;
}

/** The posting's own first line, as the history list shows it. */
function heuristicTitleLine(jd) {
  const line =
    String(jd ?? "")
      .split("\n")
      .map((l) => l.trim())
      .find(Boolean) ?? "";
  return line.slice(0, 80);
}
