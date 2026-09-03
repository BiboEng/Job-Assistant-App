import { useEffect, useState } from "react";
import FeedbackReport from "../components/FeedbackReport.jsx";
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
      <button type="button" className={`btn-ghost ${styles.back}`} onClick={onBack}>
        ← Back to home
      </button>

      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}

      {!record && !error && <p className={styles.state}>Loading…</p>}

      {record && (
        <>
          <div className={styles.jdCard}>
            <span className={styles.date}>{formatDateTime(record.createdAt)}</span>
            <h2 className={styles.jdHeading}>Job description</h2>
            <p className={styles.jd}>{record.jobDescription}</p>
          </div>

          <FeedbackReport feedback={record.feedback} title="Interview review" />
        </>
      )}
    </div>
  );
}
