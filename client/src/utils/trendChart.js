/**
 * Geometry for the Progress score-trend chart — pure, no DOM, unit-tested.
 *
 * Two decisions live here rather than in the component:
 *
 * - **The y-domain is fixed at 0–100.** Scores are out of 100, and a domain
 *   fitted to the data would draw a 62 → 66 wobble as a dramatic climb.
 * - **Points are spaced by interview, not by calendar time.** The chart answers
 *   "is each attempt better than the last?"; three interviews in one week and a
 *   fourth a month later would otherwise bunch into an unreadable clump. The
 *   dates are in the axis labels, tooltip and table instead.
 */

export const Y_TICKS = [0, 25, 50, 75, 100];

/**
 * @param {Array<object>} points chronological
 * @param {{ width: number, height: number,
 *   pad: { top: number, right: number, bottom: number, left: number },
 *   max?: number, ticks?: number[], value?: (point: object) => number }} box
 *   `max` fixes the top of the y-domain (100 for the overall score, 10 for a
 *   rubric dimension); `value` reads a point's number (default overallScore).
 */
export function trendGeometry(
  points,
  { width, height, pad, max = 100, ticks = Y_TICKS, value = (p) => p.overallScore }
) {
  const n = points.length;
  const plotW = Math.max(0, width - pad.left - pad.right);
  const plotH = Math.max(0, height - pad.top - pad.bottom);

  const x = (i) => (n <= 1 ? pad.left + plotW / 2 : pad.left + (plotW * i) / (n - 1));
  const y = (score) => pad.top + plotH * (1 - clamp(score, 0, max) / max);

  const coords = points.map((p, i) => ({ x: x(i), y: y(value(p)) }));
  const line = coords
    .map((c, i) => `${i === 0 ? "M" : "L"}${round(c.x)},${round(c.y)}`)
    .join(" ");
  const baseline = y(0);
  const area =
    coords.length > 1
      ? `${line} L${round(coords[coords.length - 1].x)},${round(baseline)} L${round(
          coords[0].x
        )},${round(baseline)} Z`
      : "";

  return {
    coords,
    line,
    area,
    ticks: ticks.map((t) => ({ value: t, y: y(t) })),
    plot: { left: pad.left, right: pad.left + plotW, top: pad.top, bottom: baseline },
  };
}

/**
 * Index of the point whose x is nearest to `px` — the crosshair snaps to it,
 * so the reader aims at an interview, never at a 2px line.
 * @param {Array<{ x: number }>} coords
 * @param {number} px
 */
export function nearestIndex(coords, px) {
  let best = -1;
  let bestDist = Infinity;
  coords.forEach((c, i) => {
    const d = Math.abs(c.x - px);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  });
  return best;
}

/**
 * Which point indices get a date under the x-axis: always the first and last,
 * plus evenly spaced ones in between when there's room, so labels never
 * collide on a narrow chart.
 * @param {number} n points
 * @param {number} plotWidth px
 * @param {number} [minGap] px each label needs
 */
export function xLabelIndices(n, plotWidth, minGap = 72) {
  if (n <= 0) return [];
  if (n === 1) return [0];
  const fit = Math.max(2, Math.floor(plotWidth / minGap) + 1);
  if (n <= fit) return Array.from({ length: n }, (_, i) => i);
  const out = new Set([0, n - 1]);
  const step = (n - 1) / (fit - 1);
  for (let k = 1; k < fit - 1; k += 1) out.add(Math.round(k * step));
  return [...out].sort((a, b) => a - b);
}

function clamp(v, lo, hi) {
  const n = Number(v);
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

function round(v) {
  return Math.round(v * 10) / 10;
}
