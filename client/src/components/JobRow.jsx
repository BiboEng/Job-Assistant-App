import Icon from "./Icon.jsx";
import styles from "./JobRow.module.css";
import { scoreBand } from "../utils/score.js";
import { relativeDay } from "../utils/time.js";

/**
 * One matched job as a dense row: score pill, title + company · location with
 * the model's one-line reason under it, salary, and when it was posted.
 *
 * Everything here is model- or API-sourced text, so it's only ever rendered as
 * text — never as HTML. `url` is validated http(s) server-side.
 *
 * The whole row is a link: opening the posting is the only thing anyone wants
 * from it. The title is the anchor and a stretched pseudo-element makes the
 * row clickable, which keeps one link per row for a screen reader rather than
 * wrapping every cell in an <a>.
 */

/**
 * Past this, an aggregator listing is far more likely to be closed than open.
 * We can't know, so the row says "may have closed" rather than hiding it.
 */
const STALE_AFTER_DAYS = 60;

export default function JobRow({ job, scoring = false }) {
  const { company, title, location, salary, url, source, matchScore, reason, postedAt } =
    job;
  const scored = Number.isFinite(matchScore);
  const band = scored ? scoreBand(matchScore) : null;
  const posted = relativeDay(postedAt);

  const postedMs = postedAt ? new Date(postedAt).getTime() : NaN;
  const stale =
    Number.isFinite(postedMs) &&
    Date.now() - postedMs > STALE_AFTER_DAYS * 24 * 60 * 60 * 1000;

  return (
    <li className={styles.row}>
      <span
        className={`${styles.pill} ${scoring ? styles.pillLoading : ""} mono`}
        style={band ? { color: band.color, background: band.soft } : undefined}
        title={scoring ? "Scoring…" : band ? band.label : "Couldn't score this role"}
        aria-label={
          scoring
            ? "Scoring this role"
            : scored
            ? `Match score ${matchScore} out of 100, ${band.label}`
            : "Not scored"
        }
      >
        {scoring ? "··" : scored ? matchScore : "—"}
      </span>

      <div className={styles.main}>
        <h3 className={styles.title}>
          <a className={styles.link} href={url} target="_blank" rel="noopener noreferrer">
            {title}
          </a>
        </h3>
        <p className={styles.meta}>
          <span className={styles.company}>{company}</span>
          <span aria-hidden="true">·</span>
          <span>{location || "Location not specified"}</span>
          {source && (
            <>
              <span aria-hidden="true">·</span>
              <span className={styles.source}>{source}</span>
            </>
          )}
        </p>
        {reason ? (
          <p className={styles.reason} title={reason}>
            {reason}
          </p>
        ) : (
          !scoring &&
          !scored && <p className={styles.reason}>Couldn't score this role.</p>
        )}
      </div>

      <span className={`${styles.salary} mono`}>{salary || ""}</span>

      <span className={styles.postedCell}>
        {posted && (
          <span className={`${styles.posted} mono ${stale ? styles.stalePosted : ""}`}>
            {posted}
          </span>
        )}
        {stale && (
          <span className={styles.staleFlag}>
            <Icon name="alert" />
            May have closed
          </span>
        )}
      </span>

      <Icon name="arrowUpRight" className={styles.linkIcon} />
    </li>
  );
}
