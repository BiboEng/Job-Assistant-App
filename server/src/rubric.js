/**
 * The answer-quality rubric: four dimensions the evaluator scores every
 * interview on (0–10 each), alongside the overall score. Progress charts each
 * one per role, so it's the same four every time — adding or renaming one
 * breaks the trend for every interview already saved.
 *
 * Keep in step with RUBRIC_DIMENSIONS in client/src/constants.js.
 */
export const RUBRIC_DIMENSIONS = [
  { key: "relevance", meaning: "how directly the answers addressed the questions and this role's needs" },
  { key: "specificity", meaning: "concrete examples, numbers, named tools and real outcomes rather than generalities" },
  { key: "structure", meaning: "clear, logical organisation — e.g. situation → action → result — that is easy to follow" },
  { key: "depth", meaning: "technical or reasoning depth: trade-offs, the why behind decisions, going beyond the surface" },
];

export const RUBRIC_KEYS = RUBRIC_DIMENSIONS.map((d) => d.key);

/**
 * Rebuilds a rubric from untrusted model output: only the known keys, each an
 * integer clamped to 0–10, or null where the model gave nothing usable. Returns
 * null when no dimension is usable, so "not scored" never reads as all zeros.
 * @param {unknown} raw
 * @returns {Record<string, number|null>|null}
 */
export function normalizeRubric(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out = {};
  let any = false;
  for (const key of RUBRIC_KEYS) {
    const v = raw[key];
    const n = v == null || v === "" ? NaN : Math.round(Number(v));
    out[key] = Number.isFinite(n) ? Math.min(10, Math.max(0, n)) : null;
    if (out[key] !== null) any = true;
  }
  return any ? out : null;
}
