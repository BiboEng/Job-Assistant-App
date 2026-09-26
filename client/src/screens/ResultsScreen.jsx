import { useState } from "react";
import FeedbackReport from "../components/FeedbackReport.jsx";
import Icon from "../components/Icon.jsx";
import Toast from "../components/Toast.jsx";
import { INTERVIEW_FOCUSES } from "../constants.js";
import styles from "./ResultsScreen.module.css";

const focusLabel = (value) =>
  INTERVIEW_FOCUSES.find((f) => f.value === value)?.short || "";

const formatWhen = (ts) =>
  new Date(ts).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

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
  session,
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
      {/* Which interview this is, as the page title. The report itself is all
          score and prose, so with several in your history a fresh one was
          indistinguishable from an old one you'd reopened. Prints too — a
          printed report with no role or date on it is not much use. */}
      <header className={styles.head}>
        <div className={styles.titleBlock}>
          <h1 className={styles.title}>{session?.role || "Interview results"}</h1>
          <div className={styles.meta}>
            {session?.totalQuestions ? (
              <span className={styles.facts}>
                {session.totalQuestions} question{session.totalQuestions === 1 ? "" : "s"}
                {focusLabel(session.focus) ? ` · ${focusLabel(session.focus)}` : ""}
                {` · ${session.mode === "speak" ? "spoken" : "typed"}`}
                {session.startedAt ? ` · ${formatWhen(session.startedAt)}` : ""}
              </span>
            ) : null}
            {/* Save state as a quiet chip beside the facts, where it's seen. */}
            {saveState === "saving" && (
              <span className={`${styles.chip} no-print`} role="status">
                Saving…
              </span>
            )}
            {saveState === "saved" && (
              <span className={`${styles.chip} ${styles.chipOk} no-print`} role="status">
                <Icon name="check" />
                Saved to history
              </span>
            )}
          </div>
        </div>

        <div className={`${styles.topActions} no-print`}>
          <button className="btn-ghost" onClick={copyReport}>
            <Icon name="fileText" />
            Copy as text
          </button>
          <button className="btn-ghost" onClick={() => window.print()}>
            <Icon name="printer" />
            Print / save PDF
          </button>
        </div>
      </header>

      <FeedbackReport feedback={feedback} />

      {saveState === "error" && (
        <div className="error-banner no-print" role="alert">
          <Icon name="alert" />
          <span>Couldn&apos;t save this interview to your history.</span>
          <button className="btn-ghost" onClick={onRetrySave}>
            Try again
          </button>
        </div>
      )}

      <div className={`${styles.actions} no-print`}>
        <button className="btn-primary" onClick={onRestart}>
          <Icon name="refresh" />
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
