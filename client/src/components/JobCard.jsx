import styles from "./JobCard.module.css";
import { scoreBand } from "../utils/score.js";
import { relativeDay } from "../utils/time.js";

/**
 * One matched job. Everything here is model- or API-sourced text, so it's only
 * ever rendered as text — never as HTML. `url` is validated http(s) server-side.
 */
export default function JobCard({ job, scoring = false }) {
  const { company, title, location, salary, url, source, matchScore, reason, postedAt } =
    job;
  const scored = Number.isFinite(matchScore);
  const band = scored ? scoreBand(matchScore) : null;
  const posted = relativeDay(postedAt);

  return (
    <div className={styles.card}>
      <div className={styles.body}>
        <div className={styles.head}>
          <h3 className={styles.title}>{title}</h3>
          <span className={styles.company}>{company}</span>
        </div>

        <div className={styles.meta}>
          <span>{location || "Location not specified"}</span>
          {salary && (
            <>
              <span aria-hidden="true">·</span>
              <span>{salary}</span>
            </>
          )}
          {posted && (
            <>
              <span aria-hidden="true">·</span>
              <span>Posted {posted}</span>
            </>
          )}
          <span aria-hidden="true">·</span>
          <span className={styles.source}>{source}</span>
        </div>

        {reason && <p className={styles.reason}>{reason}</p>}

        <a
          className={styles.link}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
        >
          View posting ↗
        </a>
      </div>

      <div
        className={styles.score}
        style={band ? { color: band.color } : undefined}
        aria-label={
          scoring
            ? "Scoring this role"
            : scored
            ? `Match score ${matchScore} out of 100`
            : "Not scored"
        }
      >
        {scoring ? (
          <span className={styles.scoreLabel}>Scoring…</span>
        ) : (
          <>
            <span className={styles.scoreNum}>{scored ? matchScore : "—"}</span>
            <span className={styles.scoreLabel}>
              {band ? band.label : "Unscored"}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
