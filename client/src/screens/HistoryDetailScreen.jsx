import { useEffect, useState } from "react";
import FeedbackReport from "../components/FeedbackReport.jsx";
import Icon from "../components/Icon.jsx";
import { getInterview } from "../api/historyApi.js";
import styles from "./HistoryDetailScreen.module.css";

function formatDateTime(ts) {
  return new Date(ts).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function HistoryDetailScreen({ interviewId, onBack }) {
  const [record, setRecord] = useState(null);
  const [error, setError] = useState("");
  const [jdOpen, setJdOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError("");
    setRecord(null);
    getInterview(interviewId)
      .then((data) => {
        if (!cancelled) setRecord(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [interviewId]);

  return (
    <div className={styles.wrap}>
      <header className="page-head">
        <h1>Interview review</h1>
        <div className={`${styles.headActions} no-print`}>
          <button type="button" className="btn-ghost" onClick={onBack}>
            <Icon name="arrowLeft" />
            Back to home
          </button>
          {record && (
            <button className="btn-ghost" onClick={() => window.print()}>
              <Icon name="printer" />
              Print / save PDF
            </button>
          )}
        </div>
      </header>

      {error && (
        <div className="error-banner" role="alert">
          <Icon name="alert" />
          <span>{error}</span>
        </div>
      )}

      {!record && !error && (
        <>
          <div className={`skeleton ${styles.skelCard}`} aria-hidden="true" />
          <div className={`skeleton ${styles.skelReport}`} aria-hidden="true" />
          <p className="sr-only">Loading this interview…</p>
        </>
      )}

      {record && (
        <>
          {/* The job description is context, not the point of the page — it
              opens on demand instead of pushing the report below the fold. */}
          <div className={styles.jdCard}>
            <button
              type="button"
              className={styles.jdToggle}
              onClick={() => setJdOpen((o) => !o)}
              aria-expanded={jdOpen}
              aria-controls="jd-body"
            >
              <span className={styles.jdHeadText}>
                <span className={styles.jdHeading}>Job description</span>
                <span className={styles.date}>{formatDateTime(record.createdAt)}</span>
              </span>
              <Icon
                name="chevronDown"
                size={16}
                className={`${styles.chevron} ${jdOpen ? styles.chevronOpen : ""}`}
              />
            </button>
            <div id="jd-body" className={styles.jdBody} hidden={!jdOpen}>
              <p className={styles.jd}>{record.jobDescription}</p>
            </div>
          </div>

          <FeedbackReport feedback={record.feedback} title="Interview review" />
        </>
      )}
    </div>
  );
}
