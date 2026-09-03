import ScoreCard from "./ScoreCard.jsx";
import { formatDuration } from "../utils/time.js";
import styles from "./FeedbackReport.module.css";

/**
 * Renders a feedback object: overall score, summary, strengths, weaknesses, and
 * the per-question breakdown. Shared by the post-interview results screen and the
 * history detail screen.
 */
export default function FeedbackReport({ feedback, title = "Your results" }) {
  const {
    overallScore = 0,
    summary = "",
    strengths = [],
    weaknesses = [],
    perQuestion = [],
  } = feedback || {};

  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        <div className={styles.headerRow}>
          <div>
            <h2 className={styles.heading}>{title}</h2>
            {summary && <p className={styles.summary}>{summary}</p>}
          </div>
          <ScoreCard score={overallScore} max={100} label="Overall" />
        </div>
      </div>

      <div className={styles.twoCol}>
        <div className={styles.card}>
          <h3 className={styles.subheading}>Strengths</h3>
          <ul className={styles.list}>
            {strengths.length ? (
              strengths.map((s, i) => <li key={i}>{s}</li>)
            ) : (
              <li className={styles.muted}>None noted</li>
            )}
          </ul>
        </div>
        <div className={styles.card}>
          <h3 className={styles.subheading}>Weaknesses</h3>
          <ul className={styles.list}>
            {weaknesses.length ? (
              weaknesses.map((w, i) => <li key={i}>{w}</li>)
            ) : (
              <li className={styles.muted}>None noted</li>
            )}
          </ul>
        </div>
      </div>

      {perQuestion.length > 0 && (
        <div className={styles.card}>
          <h3 className={styles.subheading}>Question breakdown</h3>
          {perQuestion.map((q) => (
            <div key={q.questionNumber} className={styles.qBlock}>
              <div className={styles.qHead}>
                <span className={styles.qNum}>Q{q.questionNumber}</span>
                <span className={styles.qMeta}>
                  {q.timeLimitSeconds ? (
                    <span className={styles.qTime}>
                      ⏱ {formatDuration(q.timeLimitSeconds)} limit
                    </span>
                  ) : null}
                  <span className={styles.qScore}>{q.score}/10</span>
                </span>
              </div>
              <p className={styles.qText}>{q.question}</p>
              <p className={styles.aText}>
                <span className={styles.aLabel}>Your answer:</span>{" "}
                {q.answer || <em className={styles.muted}>(no answer)</em>}
              </p>
              {q.comment && <p className={styles.comment}>{q.comment}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
