import { RUBRIC_DIMENSIONS, RUBRIC_MAX } from "../constants.js";

/**
 * Overall readiness for one Progress role — pure, no DOM, unit-tested.
 *
 * A deterministic 0–100 built from data every interview already carries, so
 * it costs no model call, can't change on a reload, and every point of it can
 * be explained. Four factors, each scored 0–100:
 *
 *   performance  the average of the last READINESS_RECENT overall scores
 *   consistency  how tightly the last READINESS_SPREAD_WINDOW scores cluster
 *   quality      the weakest rubric dimension over the last READINESS_RECENT
 *                rated interviews
 *   volume       interviews done, up to READINESS_TARGET_INTERVIEWS
 *
 * blended by READINESS_WEIGHTS and then capped at `performance`: consistency
 * and practice can only hold readiness back, never lift it past the scores
 * themselves (someone steadily scoring 20 across five interviews is not 44%
 * ready).
 *
 * Missing data is handled two ways, on purpose:
 * - consistency with a single interview is "pending": shown as no value, but
 *   it counts for nothing in the blend. One good interview hasn't shown it can
 *   be repeated, and readiness shouldn't pretend it has.
 * - quality with no rubric to read ("unrated" — saved before the rubric
 *   existed — or "locked" on a plan without insights) is left out of the blend
 *   and the other weights rescale. That's missing data, not something the
 *   candidate hasn't shown.
 */

export const READINESS_RECENT = 3;
export const READINESS_SPREAD_WINDOW = 5;
export const READINESS_TARGET_INTERVIEWS = 5;
export const READINESS_WEIGHTS = Object.freeze({
  performance: 45,
  quality: 20,
  consistency: 20,
  volume: 15,
});

/** Lowest `min` first. A score belongs to the last stage whose `min` it reaches. */
export const READINESS_STAGES = Object.freeze([
  { key: "notReady", label: "Not ready", min: 0 },
  { key: "gettingThere", label: "Getting there", min: 40 },
  { key: "almost", label: "Almost ready", min: 60 },
  { key: "ready", label: "Ready", min: 80 },
]);

// Consistency points lost per point of standard deviation: a 5-point spread
// costs 20, a 25-point one everything.
const SPREAD_PENALTY = 4;
// A factor this high isn't worth pointing at, even if it's the lowest.
const FOCUS_BELOW = 80;

/**
 * @param {Array<{ overallScore: number, rubric?: Record<string, number|null>|null }>} interviews
 *   one role's interviews, oldest first (as GET /api/progress returns them)
 * @param {{ insights?: boolean }} [opts] false on a plan without Progress
 *   insights, where the server sends no rubric
 * @returns {null | {
 *   score: number,
 *   stage: { key: string, label: string, min: number },
 *   capped: boolean,
 *   focus: string|null,
 *   factors: Array<{ key: string, label: string, weight: number,
 *     status: "measured"|"pending"|"unrated"|"locked", value: number|null,
 *     detail: object }>,
 * }} null when there's no scored interview
 */
export function readiness(interviews, { insights = true } = {}) {
  const list = Array.isArray(interviews) ? interviews.filter(Boolean) : [];
  const scores = list.map((it) => scoreOf(it.overallScore)).filter((s) => s !== null);
  if (scores.length === 0) return null;

  const factors = [
    performanceFactor(scores),
    qualityFactor(list, insights),
    consistencyFactor(scores),
    volumeFactor(scores.length),
  ];

  let points = 0;
  let weights = 0;
  for (const f of factors) {
    if (f.status === "unrated" || f.status === "locked") continue;
    weights += f.weight;
    points += f.weight * (f.value ?? 0);
  }
  const blend = points / weights;
  const performance = factors[0].value;
  const score = Math.round(Math.min(blend, performance));

  return {
    score,
    stage: stageOf(score),
    capped: Math.round(blend) > performance,
    focus: focusOf(factors),
    factors,
  };
}

/** The stage a 0–100 readiness falls in. */
export function stageOf(score) {
  let stage = READINESS_STAGES[0];
  for (const s of READINESS_STAGES) if (score >= s.min) stage = s;
  return stage;
}

function performanceFactor(scores) {
  const recent = scores.slice(-READINESS_RECENT);
  return {
    key: "performance",
    label: "Recent performance",
    weight: READINESS_WEIGHTS.performance,
    status: "measured",
    value: Math.round(mean(recent)),
    detail: { count: recent.length },
  };
}

function consistencyFactor(scores) {
  const base = { key: "consistency", label: "Consistency", weight: READINESS_WEIGHTS.consistency };
  if (scores.length < 2) return { ...base, status: "pending", value: null, detail: { count: 1 } };

  const window = scores.slice(-READINESS_SPREAD_WINDOW);
  const avg = mean(window);
  const sd = Math.sqrt(mean(window.map((s) => (s - avg) ** 2)));
  return {
    ...base,
    status: "measured",
    value: clamp(Math.round(100 - SPREAD_PENALTY * sd)),
    detail: { count: window.length, low: Math.min(...window), high: Math.max(...window) },
  };
}

function qualityFactor(list, insights) {
  const base = { key: "quality", label: "Weakest dimension", weight: READINESS_WEIGHTS.quality };
  if (!insights) return { ...base, status: "locked", value: null, detail: {} };

  const rated = list.filter((it) => it.rubric && typeof it.rubric === "object").slice(-READINESS_RECENT);
  let weakest = null;
  for (const dim of RUBRIC_DIMENSIONS) {
    const values = rated.map((it) => rubricValueOf(it.rubric[dim.key])).filter((v) => v !== null);
    if (values.length === 0) continue;
    const average = Math.round(mean(values) * 10) / 10;
    // Strictly lower, so a tie goes to the dimension listed first.
    if (!weakest || average < weakest.average) weakest = { dim, average };
  }
  if (!weakest) return { ...base, status: "unrated", value: null, detail: {} };

  const { key, label, hint } = weakest.dim;
  return {
    ...base,
    status: "measured",
    value: clamp(Math.round((weakest.average / RUBRIC_MAX) * 100)),
    detail: { dimension: { key, label, hint }, average: weakest.average, count: rated.length },
  };
}

function volumeFactor(count) {
  return {
    key: "volume",
    label: "Practice volume",
    weight: READINESS_WEIGHTS.volume,
    status: "measured",
    value: Math.round((Math.min(count, READINESS_TARGET_INTERVIEWS) / READINESS_TARGET_INTERVIEWS) * 100),
    detail: { count, target: READINESS_TARGET_INTERVIEWS },
  };
}

/**
 * The factor to work on: the lowest measured one, ties to the heavier weight
 * (factors are listed heaviest first). None when everything is already high.
 */
function focusOf(factors) {
  let low = null;
  for (const f of factors) {
    if (f.status !== "measured") continue;
    if (!low || f.value < low.value) low = f;
  }
  return low && low.value < FOCUS_BELOW ? low.key : null;
}

function scoreOf(v) {
  const n = Number(v);
  return v === null || v === undefined || v === "" || !Number.isFinite(n) ? null : clamp(Math.round(n));
}

function rubricValueOf(v) {
  const n = Number(v);
  if (v === null || v === undefined || v === "" || !Number.isFinite(n)) return null;
  return Math.min(RUBRIC_MAX, Math.max(0, n));
}

function mean(values) {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function clamp(n) {
  return Math.min(100, Math.max(0, n));
}
