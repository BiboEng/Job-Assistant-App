import { useState } from "react";
import Icon from "./Icon.jsx";
import styles from "./InterviewRow.module.css";
import { scoreBand } from "../utils/score.js";

function formatDate(ts) {
  return new Date(ts).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * One saved interview as a table row: role + snippet, answered count, date,
 * score pill, and a delete control. The whole row (bar the delete button)
 * opens the report. Column widths live in HomeScreen.module.css's `.columns`
 * header and are mirrored here — change them together.
 */
export default function InterviewRow({ interview, onOpen, onDelete }) {
  const { title, snippet, createdAt, overallScore, answeredCount, totalQuestions } =
    interview;
  const band = scoreBand(overallScore);
  const name = title || "Untitled role";

  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function confirmDelete() {
    setDeleting(true);
    try {
      await onDelete();
      // On success the row unmounts (removed from the list).
    } catch {
      setDeleting(false);
      setConfirming(false);
    }
  }

  return (
    <div className={styles.row} role="listitem">
      <button type="button" className={styles.open} onClick={onOpen}>
        <span className={styles.role}>
          <span className={styles.title}>{name}</span>
          {snippet && <span className={styles.snippet}>{snippet}</span>}
        </span>
        <span className={`${styles.answered} mono`}>
          {answeredCount}/{totalQuestions}
        </span>
        <time className={styles.date} dateTime={new Date(createdAt).toISOString()}>
          {formatDate(createdAt)}
        </time>
        {/* Tinted per band so the column scans at a glance. */}
        <span className={styles.scoreCell}>
          <span
            className={`${styles.pill} mono`}
            style={{ color: band.color, background: band.soft }}
            title={band.label}
          >
            {overallScore}
            <span className="sr-only"> out of 100, {band.label}</span>
          </span>
        </span>
      </button>

      <div className={styles.actions}>
        {confirming ? (
          <div className={styles.confirm} role="group" aria-label="Confirm delete">
            <span className={styles.confirmText}>Delete?</span>
            <button
              type="button"
              className="btn-danger btn-sm"
              onClick={confirmDelete}
              disabled={deleting}
            >
              {deleting ? "Deleting…" : "Delete"}
            </button>
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={() => setConfirming(false)}
              disabled={deleting}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            className={styles.deleteBtn}
            onClick={() => setConfirming(true)}
            aria-label={`Delete interview: ${name}`}
            title="Delete"
          >
            <Icon name="trash" />
          </button>
        )}
      </div>
    </div>
  );
}
