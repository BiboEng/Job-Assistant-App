import { RUBRIC_DIMENSIONS, RUBRIC_MAX } from "../constants.js";

/**
 * Answer-quality series for Progress — pure, no DOM, unit-tested.
 *
 * Each interview may carry `rubric: { relevance, specificity, structure,
 * depth }` (0–10 each, any of them null), or `rubric: null` when it was saved
 * before the evaluator scored one. Interviews without a value for a dimension
 * are simply not points on that dimension's line — never zeros, which would
 * draw a collapse that didn't happen.
 */

/**
 * @param {Array<{ id: string, createdAt: number, jobTitle?: string,
 *   rubric?: Record<string, number|null>|null }>} interviews oldest first
 * @returns {{ rated: number, dimensions: Array<{ key: string, label: string,
 *   hint: string, points: Array<{ id: string, createdAt: number, jobTitle?: string,
 *   value: number }>, latest: number|null, average: number|null,
 *   change: number|null }> }}
 */
export function rubricSeries(interviews) {
  const list = Array.isArray(interviews) ? interviews : [];
  const rated = list.filter((it) => it && it.rubric && typeof it.rubric === "object").length;

  const dimensions = RUBRIC_DIMENSIONS.map(({ key, label, hint }) => {
    const points = [];
    for (const it of list) {
      const v = valueOf(it?.rubric?.[key]);
      if (v === null) continue;
      points.push({ id: it.id, createdAt: it.createdAt, jobTitle: it.jobTitle, value: v });
    }
    const values = points.map((p) => p.value);
    const n = values.length;
    return {
      key,
      label,
      hint,
      points,
      latest: n ? values[n - 1] : null,
      average: n ? round1(values.reduce((a, b) => a + b, 0) / n) : null,
      // Like the overall score: one point is no trend, so no change either.
      change: n > 1 ? values[n - 1] - values[0] : null,
    };
  });

  return { rated, dimensions };
}

/**
 * The dimension to work on next: lowest average, ties to the lower latest.
 * Null when nothing has been rated, or when every dimension averages the same
 * (there's no "weakest" to point at).
 * @param {ReturnType<typeof rubricSeries>["dimensions"]} dimensions
 */
export function weakestDimension(dimensions) {
  const scored = (dimensions ?? []).filter((d) => d.average !== null);
  if (scored.length < 2) return null;
  const sorted = [...scored].sort(
    (a, b) => a.average - b.average || (a.latest ?? 0) - (b.latest ?? 0)
  );
  if (sorted[0].average === sorted[sorted.length - 1].average) return null;
  return sorted[0];
}

function valueOf(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return null;
  return Math.min(RUBRIC_MAX, Math.max(0, n));
}

function round1(v) {
  return Math.round(v * 10) / 10;
}
