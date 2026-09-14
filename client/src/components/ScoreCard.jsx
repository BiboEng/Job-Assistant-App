import { useEffect, useState } from "react";
import styles from "./ScoreCard.module.css";
import { scoreBand, pctOf } from "../utils/score.js";

/**
 * The overall-score ring. The arc animates from zero on mount — the score is
 * the payoff for finishing an interview, and a number that simply appears
 * doesn't feel like one. Reduced-motion users get the final value immediately
 * (the transition is disabled globally in index.css).
 */
export default function ScoreCard({ score, max = 100, label, size = 132 }) {
  const pct = pctOf(score, max);
  const band = scoreBand(pct);

  const [drawn, setDrawn] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setDrawn(pct));
    return () => cancelAnimationFrame(id);
  }, [pct]);

  return (
    <div
      className={styles.card}
      role="img"
      aria-label={`${label ? `${label} score: ` : ""}${score} out of ${max}. ${band.label}.`}
    >
      <div
        className={styles.ring}
        style={{
          "--pct": drawn,
          "--c": band.color,
          width: size,
          height: size,
        }}
        aria-hidden="true"
      >
        <span className={styles.inner} style={{ width: size - 26, height: size - 26 }}>
          <span className={styles.value}>
            {score}
            <small>/{max}</small>
          </span>
          {label && <span className={styles.label}>{label}</span>}
        </span>
      </div>
      <span className={styles.band} style={{ color: band.color, background: band.soft }}>
        {band.label}
      </span>
    </div>
  );
}
