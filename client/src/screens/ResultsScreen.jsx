import { useState } from "react";
import FeedbackReport from "../components/FeedbackReport.jsx";
import Icon from "../components/Icon.jsx";
import Toast from "../components/Toast.jsx";
import styles from "./ResultsScreen.module.css";

/** Plain-text version of a report, for pasting into notes or a journal. */
function asText(feedback) {
  const lines = [`Overall score: ${feedback.overallScore}/100`];
  if (feedback.summary) lines.push("", feedback.summary);
  if (feedback.strengths?.length) {
    lines.push("", "Strengths:", ...feedback.strengths.map((s) => `- ${s}`));
  }
  if (feedback.weaknesses?.length) {
    lines.push("", "Areas to work on:", ...feedback.weaknesses.map((s) => `- ${s}`));
  }
  if (feedback.perQuestion?.length) {
    lines.push("", "Question breakdown:");
    for (const q of feedback.perQuestion) {
      lines.push("", `Q${q.questionNumber} (${q.score}/10): ${q.question}`);
      lines.push(`Your answer: ${q.answer || "(no answer)"}`);
      if (q.comment) lines.push(`Feedback: ${q.comment}`);
    }
  }
  return lines.join("\n");
}

export default function ResultsScreen({
  feedback,
  saveState = "idle",
  onRetrySave,
  onRestart,
  onHome,
}) {
  const [toast, setToast] = useState(null);

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

  async function copyReport() {
    try {
      await navigator.clipboard.writeText(asText(feedback));
      setToast({ message: "Report copied to your clipboard", tone: "success" });
    } catch {
      setToast({ message: "Couldn't copy — your browser blocked it", tone: "error" });
    }
  }

  return (
    <div className={styles.wrap}>
      <div className={`${styles.topBar} no-print`}>
        {/* Save state lives up here as a quiet chip rather than a line of grey
            text below the report, where it was easy to miss. */}
        <div className={styles.saveState}>
          {saveState === "saving" && (
            <span className={styles.chip} role="status">
              Saving to your history…
            </span>
          )}
          {saveState === "saved" && (
            <span className={`${styles.chip} ${styles.chipOk}`} role="status">
              <Icon name="check" size={14} />
              Saved to your history
            </span>
          )}
        </div>

        <div className={styles.topActions}>
          <button className="btn-ghost btn-sm" onClick={copyReport}>
            <Icon name="fileText" size={15} />
            Copy as text
          </button>
          <button className="btn-ghost btn-sm" onClick={() => window.print()}>
            <Icon name="printer" size={15} />
            Print / save PDF
          </button>
        </div>
      </div>

      <FeedbackReport feedback={feedback} />

      {saveState === "error" && (
        <div className="error-banner no-print" role="alert">
          <Icon name="alert" size={16} />
          <span>Couldn&apos;t save this interview to your history.</span>
          <button className="btn-ghost" onClick={onRetrySave}>
            Try again
          </button>
        </div>
      )}

      <div className={`${styles.actions} no-print`}>
        <button className="btn-primary" onClick={onRestart}>
          <Icon name="refresh" size={16} />
          New interview
        </button>
        <button className="btn-ghost" onClick={onHome}>
          Back to home
        </button>
      </div>

      <Toast
        message={toast?.message}
        tone={toast?.tone}
        onDismiss={() => setToast(null)}
      />
    </div>
  );
}
