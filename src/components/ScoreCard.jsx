import styles from "./ScoreCard.module.css";
import { scoreBand, pctOf } from "../utils/score.js";

export default function ScoreCard({ score, max = 100, label }) {
  const pct = pctOf(score, max);
  const band = scoreBand(pct);

  return (
    <div
      className={styles.card}
      role="img"
      aria-label={`${label ? `${label} score: ` : ""}${score} out of ${max}. ${band.label}.`}
    >
      <div
        className={styles.ring}
        style={{ "--pct": pct, "--c": band.color }}
        aria-hidden="true"
      >
        <span className={styles.value}>
          {score}
          <small>/{max}</small>
        </span>
      </div>
      {label && <span className={styles.label}>{label}</span>}
      <span className={styles.band} style={{ color: band.color }}>
        {band.label}
      </span>
    </div>
  );
}
