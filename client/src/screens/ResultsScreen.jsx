import FeedbackReport from "../components/FeedbackReport.jsx";
import styles from "./ResultsScreen.module.css";

export default function ResultsScreen({
  feedback,
  saveState = "idle",
  onRetrySave,
  onRestart,
  onHome,
}) {
  if (!feedback) {
    return (
      <div className={styles.empty}>
        <p>No feedback available.</p>
        <button className="btn-primary" onClick={onRestart}>
          Start over
        </button>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <FeedbackReport feedback={feedback} />

      {saveState === "error" && (
        <div className="error-banner" role="alert">
          Couldn&apos;t save this interview to your history.{" "}
          <button className="btn-ghost" onClick={onRetrySave}>
            Try again
          </button>
        </div>
      )}
      {saveState === "saving" && (
        <p className={styles.saveNote} role="status">
          Saving to your history…
        </p>
      )}
      {saveState === "saved" && (
        <p className={styles.saveNote} role="status">
          Saved to your history.
        </p>
      )}

      <div className={styles.actions}>
        <button className="btn-primary" onClick={onRestart}>
          New interview
        </button>
        <button className="btn-ghost" onClick={onHome}>
          Back to home
        </button>
      </div>
    </div>
  );
}
