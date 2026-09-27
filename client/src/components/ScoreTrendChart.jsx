import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { nearestIndex, trendGeometry, xLabelIndices } from "../utils/trendChart.js";
import { scoreBand } from "../utils/score.js";
import styles from "./ScoreTrendChart.module.css";

const HEIGHT = 220;
const PAD = { top: 16, right: 28, bottom: 32, left: 36 };

function shortDate(ts) {
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function longDate(ts) {
  return new Date(ts).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * One role's interview scores, oldest → newest, as a single-series line.
 *
 * Hand-drawn SVG, like everything else here (no chart library). One series, so
 * no legend — the section heading names it. The line is the accent; text is
 * text tokens. The y-axis is fixed at 0–100 and points are spaced by
 * interview rather than by date (see utils/trendChart.js for why).
 *
 * Interaction: a crosshair snaps to the nearest interview on hover, with a
 * tooltip (score first, then date and the posting's first line). The chart is
 * one tab stop; arrow keys step between interviews, Enter opens the focused
 * one, and a click on the crosshair column opens that interview. A visually
 * hidden table carries every value for screen readers.
 *
 * The SVG is drawn at the container's real pixel width (ResizeObserver) so
 * text and markers never stretch.
 */
export default function ScoreTrendChart({ interviews, onOpenInterview, label }) {
  const wrapRef = useRef(null);
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState(-1);
  const tableId = useId();

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const measure = () => {
      const w = Math.floor(el.getBoundingClientRect().width);
      if (w > 0) setWidth(w);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // A different role is a different series — drop the old crosshair.
  useEffect(() => setActive(-1), [interviews]);

  const geo = width > 0 ? trendGeometry(interviews, { width, height: HEIGHT, pad: PAD }) : null;
  const labels = geo ? new Set(xLabelIndices(interviews.length, geo.plot.right - geo.plot.left)) : null;
  const last = interviews.length - 1;

  function indexAt(clientX) {
    const rect = wrapRef.current.getBoundingClientRect();
    return nearestIndex(geo.coords, clientX - rect.left);
  }

  function onKeyDown(e) {
    if (!geo) return;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const dir = e.key === "ArrowRight" ? 1 : -1;
      setActive((i) => {
        if (i < 0) return dir > 0 ? 0 : last;
        return Math.min(last, Math.max(0, i + dir));
      });
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      setActive(e.key === "Home" ? 0 : last);
    } else if ((e.key === "Enter" || e.key === " ") && active >= 0) {
      e.preventDefault();
      onOpenInterview?.(interviews[active].id);
    } else if (e.key === "Escape") {
      setActive(-1);
    }
  }

  const point = geo && active >= 0 ? geo.coords[active] : null;
  const item = active >= 0 ? interviews[active] : null;
  // Keep the tooltip inside the chart: flip it left of the crosshair past the midpoint.
  const flip = point && point.x > width / 2;

  return (
    <div className={styles.chart}>
      <div
        ref={wrapRef}
        className={styles.canvas}
        style={{ height: HEIGHT }}
        tabIndex={0}
        role="group"
        aria-label={`${label}. Use the left and right arrow keys to step through interviews, Enter to open one.`}
        aria-describedby={tableId}
        onKeyDown={onKeyDown}
        onPointerMove={(e) => geo && setActive(indexAt(e.clientX))}
        onPointerLeave={() => setActive(-1)}
        onBlur={() => setActive(-1)}
        onClick={(e) => {
          if (!geo) return;
          const i = indexAt(e.clientX);
          if (i >= 0) onOpenInterview?.(interviews[i].id);
        }}
      >
        {geo && (
          <svg width={width} height={HEIGHT} className={styles.svg} aria-hidden="true">
            {geo.ticks.map((t) => (
              <g key={t.value}>
                <line
                  className={styles.grid}
                  x1={geo.plot.left}
                  x2={geo.plot.right}
                  y1={t.y}
                  y2={t.y}
                />
                <text className={styles.tick} x={geo.plot.left - 10} y={t.y} textAnchor="end" dominantBaseline="middle">
                  {t.value}
                </text>
              </g>
            ))}

            {interviews.map((it, i) =>
              labels.has(i) ? (
                <text
                  key={it.id}
                  className={styles.tick}
                  x={geo.coords[i].x}
                  y={HEIGHT - 10}
                  textAnchor={i === 0 && last > 0 ? "start" : i === last && last > 0 ? "end" : "middle"}
                >
                  {shortDate(it.createdAt)}
                </text>
              ) : null
            )}

            {point && (
              <line
                className={styles.crosshair}
                x1={point.x}
                x2={point.x}
                y1={geo.plot.top}
                y2={geo.plot.bottom}
              />
            )}

            {geo.area && <path className={styles.area} d={geo.area} />}
            <path className={styles.line} d={geo.line} />

            {geo.coords.map((c, i) => (
              <circle
                key={interviews[i].id}
                className={`${styles.dot} ${i === active ? styles.dotActive : ""}`}
                cx={c.x}
                cy={c.y}
                r={i === active ? 5 : 4}
              />
            ))}

            {/* One direct label: the latest score, at the end of the line. */}
            {active !== last && (
              <text
                className={styles.endLabel}
                x={geo.coords[last].x}
                y={geo.coords[last].y - 12}
                textAnchor={last > 0 ? "end" : "middle"}
              >
                {interviews[last].overallScore}
              </text>
            )}
          </svg>
        )}

        {point && item && (
          <div
            className={`${styles.tooltip} ${flip ? styles.tooltipLeft : ""}`}
            style={{ left: point.x, top: Math.max(PAD.top, point.y - 8) }}
            aria-hidden="true"
          >
            <span className={styles.tipValue}>
              {item.overallScore}
              <span className={styles.tipBand}>
                <span
                  className={styles.tipSwatch}
                  style={{ background: scoreBand(item.overallScore).color }}
                />
                {scoreBand(item.overallScore).label}
              </span>
            </span>
            <span className={styles.tipMeta}>
              Interview {active + 1} · {longDate(item.createdAt)}
            </span>
            {item.jobTitle && <span className={styles.tipJob}>{item.jobTitle}</span>}
          </div>
        )}
      </div>

      {/* aria-live so arrowing through the chart announces each interview. */}
      <p className="sr-only" aria-live="polite">
        {item
          ? `Interview ${active + 1} of ${interviews.length}, ${longDate(item.createdAt)}: score ${item.overallScore} out of 100.`
          : ""}
      </p>

      {/* The sr-only class goes on a wrapper: a <table> ignores the 1px width
          it sets, and would poke out of the chart and widen the page. */}
      <div className="sr-only">
        <table id={tableId}>
          <caption>{label}</caption>
          <thead>
            <tr>
              <th scope="col">Interview</th>
              <th scope="col">Date</th>
              <th scope="col">Score</th>
            </tr>
          </thead>
          <tbody>
            {interviews.map((it, i) => (
              <tr key={it.id}>
                <td>{i + 1}</td>
                <td>{longDate(it.createdAt)}</td>
                <td>{it.overallScore}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
