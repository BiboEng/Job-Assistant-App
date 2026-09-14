import { useState } from "react";
import Icon from "./Icon.jsx";
import styles from "./InterviewCard.module.css";
import { scoreBand } from "../utils/score.js";

function formatDate(ts) {
  return new Date(ts).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function InterviewCard({ interview, onOpen, onDelete }) {
  const { title, snippet, createdAt, overallScore, answeredCount, totalQuestions } =
    interview;
  const band = scoreBand(overallScore);

  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function confirmDelete() {
    setDeleting(true);
    try {
      await onDelete();
      // On success the card unmounts (removed from the list).
    } catch {
      setDeleting(false);
      setConfirming(false);
    }
  }

  return (
    <div className={styles.card}>
      <button type="button" className={styles.open} onClick={onOpen}>
        <div className={styles.main}>
          <h3 className={styles.title}>{title || "Untitled role"}</h3>
          <p className={styles.snippet}>{snippet}</p>
          <div className={styles.meta}>
            <span>{formatDate(createdAt)}</span>
            <span aria-hidden="true">·</span>
            <span>
              {answeredCount}/{totalQuestions} answered
            </span>
          </div>
        </div>

        {/* Tinted per band so the list is scannable at a glance instead of
            needing each number read. */}
        <div
          className={styles.scorePill}
          style={{ color: band.color, background: band.soft, borderColor: band.color }}
        >
          <span className={styles.scoreNum}>{overallScore}</span>
          <span className={styles.scoreLabel}>{band.label}</span>
        </div>
      </button>

      {confirming ? (
        <div className={styles.confirm} role="group" aria-label="Confirm delete">
          <span className={styles.confirmText}>Delete this interview?</span>
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
          aria-label={`Delete interview: ${title || "Untitled role"}`}
          title="Delete"
        >
          <Icon name="trash" size={15} />
        </button>
      )}
    </div>
  );
}
