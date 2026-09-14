import { useState } from "react";
import ScoreCard from "./ScoreCard.jsx";
import Icon from "./Icon.jsx";
import { formatDuration } from "../utils/time.js";
import { scoreBand, pctOf } from "../utils/score.js";
import styles from "./FeedbackReport.module.css";

/**
 * Renders a feedback object: overall score, summary, strengths, weaknesses, and
 * the per-question breakdown. Shared by the post-interview results screen and
 * the history detail screen.
 *
 * The breakdown is an accordion. Fully expanded, a six-question report is a wall
 * of text — question, full answer and comment for each — with no way to skim.
 * Collapsed, every row still shows the question and its score, so the shape of
 * the result is legible at a glance and detail is one click away.
 */
export default function FeedbackReport({ feedback, title = "Your results" }) {
  const {
    overallScore = 0,
    summary = "",
    strengths = [],
    weaknesses = [],
    perQuestion = [],
  } = feedback || {};

  // Weakest question opens by default — it's the one worth reading.
  const [open, setOpen] = useState(() => {
    if (perQuestion.length === 0) return new Set();
    const weakest = perQuestion.reduce((a, b) => (b.score < a.score ? b : a));
    return new Set([weakest.questionNumber]);
  });

  const allOpen = open.size === perQuestion.length && perQuestion.length > 0;

  function toggle(n) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });
  }

  function toggleAll() {
    setOpen(allOpen ? new Set() : new Set(perQuestion.map((q) => q.questionNumber)));
  }

  return (
    <div className={styles.wrap}>
      <div className={`${styles.card} ${styles.headerCard}`}>
        <div className={styles.headerRow}>
          <div className={styles.headerText}>
            <h2 className={styles.heading}>{title}</h2>
            {summary && <p className={styles.summary}>{summary}</p>}
          </div>
          <ScoreCard score={overallScore} max={100} label="Overall" />
        </div>
      </div>

      <div className={styles.twoCol}>
        <PointList
          tone="strong"
          icon="check"
          title="Strengths"
          items={strengths}
          emptyText="None noted"
        />
        <PointList
          tone="weak"
          icon="target"
          title="Areas to work on"
          items={weaknesses}
          emptyText="None noted"
        />
      </div>

      {perQuestion.length > 0 && (
        <div className={styles.card}>
          <div className={styles.breakdownHead}>
            <h3 className={styles.subheading}>Question breakdown</h3>
            <button type="button" className="btn-subtle btn-sm no-print" onClick={toggleAll}>
              {allOpen ? "Collapse all" : "Expand all"}
            </button>
          </div>

          <div className={styles.qList}>
            {perQuestion.map((q) => {
              const isOpen = open.has(q.questionNumber);
              const band = scoreBand(pctOf(q.score, 10));
              return (
                <div key={q.questionNumber} className={styles.qBlock}>
                  <button
                    type="button"
                    className={styles.qToggle}
                    onClick={() => toggle(q.questionNumber)}
                    aria-expanded={isOpen}
                    aria-controls={`q-body-${q.questionNumber}`}
                  >
                    <span className={styles.qNum}>Q{q.questionNumber}</span>
                    <span className={styles.qText}>{q.question}</span>
                    <span className={styles.qRight}>
                      {q.timeLimitSeconds ? (
                        <span className={styles.qTime}>
                          <Icon name="clock" size={13} />
                          {formatDuration(q.timeLimitSeconds)}
                        </span>
                      ) : null}
                      <span
                        className={styles.qScore}
                        style={{ color: band.color, background: band.soft }}
                      >
                        {q.score}/10
                      </span>
                      <Icon
                        name="chevronDown"
                        size={16}
                        className={`${styles.qChevron} ${isOpen ? styles.qChevronOpen : ""}`}
                      />
                    </span>
                  </button>

                  {/* A score bar under the header: visible whether or not the
                      row is expanded, so scanning works while collapsed. */}
                  <div className={styles.qBar} aria-hidden="true">
                    <div
                      className={styles.qBarFill}
                      style={{
                        width: `${pctOf(q.score, 10)}%`,
                        background: band.color,
                      }}
                    />
                  </div>

                  <div
                    id={`q-body-${q.questionNumber}`}
                    className={styles.qBody}
                    hidden={!isOpen}
                  >
                    <p className={styles.aText}>
                      <span className={styles.aLabel}>Your answer</span>
                      {q.answer || <em className={styles.muted}>(no answer)</em>}
                    </p>
                    {q.comment && (
                      <p className={styles.comment}>
                        <Icon name="sparkles" size={14} />
                        <span>{q.comment}</span>
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Strengths and weaknesses used to be two identical grey cards, which meant you
 * had to read the heading to know which one you were looking at. They're now
 * distinguished by color and icon as well as by title.
 */
function PointList({ tone, icon, title, items, emptyText }) {
  return (
    <div className={`${styles.card} ${styles[tone]}`}>
      <h3 className={styles.subheading}>
        <span className={styles.pointIcon} aria-hidden="true">
          <Icon name={icon} size={14} />
        </span>
        {title}
      </h3>
      <ul className={styles.list}>
        {items.length ? (
          items.map((s, i) => (
            <li key={i}>
              <span className={styles.bullet} aria-hidden="true" />
              {s}
            </li>
          ))
        ) : (
          <li className={styles.muted}>{emptyText}</li>
        )}
      </ul>
    </div>
  );
}
