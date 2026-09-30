import Icon from "./Icon.jsx";
import styles from "./ApplicationCard.module.css";
import { STAGES, formatDay, interviewFlag } from "../applications/applicationModel.js";
import { relativeDay } from "../utils/time.js";

/**
 * One application on the board.
 *
 * Three ways to act on it, deliberately separate:
 *   - drag it to another column (native HTML5 drag and drop — mouse only);
 *   - the stage <select> in its footer, which is the keyboard and touch
 *     alternative and moves it exactly the same way;
 *   - click anywhere else to open the detail view. That's one <button>
 *     stretched over the card (as JobRow does with its link), so there's a
 *     single "open" control per card rather than a clickable <li>.
 *
 * An interview date is the loudest thing on the card when it's close: that's
 * the one piece of information the board exists to keep in front of you.
 *
 * Every field is user-entered or copied from a job listing, so it's rendered
 * as text only.
 */
export default function ApplicationCard({
  app,
  now,
  dragging = false,
  landed = false,
  onOpen,
  onMove,
  onDragStart,
  onDragEnd,
}) {
  const flag = interviewFlag(app.interviewAt, now);
  const decided = app.stage === "accepted" || app.stage === "rejected";
  const when = app.appliedOn
    ? `Applied ${formatDay(app.appliedOn, now)}`
    : app.createdAt
    ? `Added ${relativeDay(app.createdAt)}`
    : "";
  const note = app.notes.trim().split("\n")[0];

  function handleDragStart(e) {
    e.dataTransfer.effectAllowed = "move";
    // Firefox won't start a drag without data. The id also lets a drop
    // resolve the card without trusting component state alone.
    e.dataTransfer.setData("text/plain", app.id);
    onDragStart?.(app.id);
  }

  return (
    <li
      className={[
        styles.card,
        dragging ? styles.dragging : "",
        landed ? styles.landed : "",
        app.stage === "rejected" ? styles.rejected : "",
      ].join(" ")}
      draggable
      onDragStart={handleDragStart}
      onDragEnd={() => onDragEnd?.()}
    >
      <div className={styles.head}>
        <h3 className={styles.title}>
          <button
            type="button"
            className={styles.open}
            onClick={() => onOpen?.(app.id)}
            aria-label={`${app.jobTitle} at ${app.company}. Open details`}
          >
            {app.jobTitle}
          </button>
        </h3>
        {decided && (
          <span
            className={`${styles.outcome} ${
              app.stage === "accepted" ? styles.accepted : styles.rejectedBadge
            } mono`}
          >
            {app.stage === "accepted" ? "Accepted" : "Rejected"}
          </span>
        )}
      </div>

      <p className={styles.company}>{app.company}</p>

      {flag && (
        <p className={`${styles.flag} ${styles[flag.tone]}`} title={flag.full}>
          <Icon name="calendarClock" />
          <span>{flag.label}</span>
        </p>
      )}

      {note && <p className={styles.note}>{note}</p>}

      <div className={styles.foot}>
        <span className={`${styles.when} mono`}>{when}</span>
        <span className={styles.actions}>
          {app.postingUrl && (
            <a
              className={styles.link}
              href={app.postingUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Open the ${app.jobTitle} posting in a new tab`}
              title="Open posting"
              draggable={false}
            >
              <Icon name="externalLink" />
            </a>
          )}
          <select
            className={styles.stage}
            value={app.stage}
            onChange={(e) => onMove?.(app.id, e.target.value)}
            aria-label={`Stage for ${app.jobTitle} at ${app.company}`}
          >
            {STAGES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </span>
      </div>
    </li>
  );
}
