import Icon from "./Icon.jsx";
import styles from "./JobCard.module.css";
import { scoreBand } from "../utils/score.js";
import { relativeDay } from "../utils/time.js";

/**
 * One matched job. Everything here is model- or API-sourced text, so it's only
 * ever rendered as text — never as HTML. `url` is validated http(s) server-side.
 *
 * The whole card is a link: opening the posting is the only thing anyone wants
 * from this card, and it used to be a small run of blue text at the bottom. The
 * heading is the anchor and a stretched pseudo-element makes the card surface
 * clickable, which keeps one link per card for a screen reader rather than
 * wrapping every line in an <a>.
 */
export default function JobCard({ job, scoring = false }) {
  const { company, title, location, salary, url, source, matchScore, reason, postedAt } =
    job;
  const scored = Number.isFinite(matchScore);
  const band = scored ? scoreBand(matchScore) : null;
  const posted = relativeDay(postedAt);

  return (
    <article className={styles.card}>
      <div className={styles.body}>
        <h3 className={styles.title}>
          <a
            className={styles.link}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {title}
            <Icon name="arrowUpRight" size={15} className={styles.linkIcon} />
          </a>
        </h3>
        <p className={styles.company}>{company}</p>

        <div className={styles.meta}>
          <span className={styles.metaItem}>
            <Icon name="mapPin" size={13} />
            {location || "Location not specified"}
          </span>
          {salary && <span className={styles.salary}>{salary}</span>}
          {posted && <span className={styles.metaItem}>Posted {posted}</span>}
          <span className={styles.source}>{source}</span>
        </div>

        {reason && <p className={styles.reason}>{reason}</p>}
      </div>

      <div
        className={`${styles.score} ${scoring ? styles.scoreLoading : ""}`}
        style={band ? { color: band.color, background: band.soft, borderColor: band.color } : undefined}
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
            <span className={styles.scoreLabel}>{band ? band.label : "Unscored"}</span>
          </>
        )}
      </div>
    </article>
  );
}
