import { useEffect, useState } from "react";
import InterviewCard from "../components/InterviewCard.jsx";
import { listInterviews, deleteInterview } from "../api/historyApi.js";
import styles from "./HomeScreen.module.css";

export default function HomeScreen({ onStartNew, onOpenInterview }) {
  const [interviews, setInterviews] = useState(null); // null = loading
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setError("");
    setInterviews(null);
    listInterviews()
      .then((data) => {
        if (!cancelled) setInterviews(Array.isArray(data) ? data : []);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message);
          setInterviews([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleDelete(id) {
    setActionError("");
    try {
      await deleteInterview(id);
      setInterviews((list) => list.filter((it) => it.id !== id));
    } catch (err) {
      setActionError(err.message || "Could not delete that interview.");
      throw err; // let the card reset its confirm state
    }
  }

  const loading = interviews === null;
  const isEmpty = !loading && interviews.length === 0 && !error;

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <div>
          <h2 className={styles.heading}>Practice history</h2>
          <p className={styles.sub}>Review a past mock interview or start a new one.</p>
        </div>
        <button className="btn-primary" onClick={onStartNew}>
          Start New Interview
        </button>
      </div>

      {error && (
        <div className="error-banner" role="alert">
          Couldn't load your history: {error}
        </div>
      )}

      {actionError && (
        <div className="error-banner" role="alert">
          {actionError}
        </div>
      )}

      {loading && <p className={styles.state}>Loading…</p>}

      {isEmpty && (
        <div className={styles.empty}>
          <div className={styles.emptyIcon} aria-hidden="true">
            🎤
          </div>
          <h3 className={styles.emptyTitle}>No interviews yet</h3>
          <p className={styles.emptyText}>
            Start your first one and it&apos;ll show up here.
          </p>
          <button className="btn-primary" onClick={onStartNew}>
            Start New Interview
          </button>
        </div>
      )}

      {!loading && interviews.length > 0 && (
        <div className={styles.list}>
          {interviews.map((it) => (
            <InterviewCard
              key={it.id}
              interview={it}
              onOpen={() => onOpenInterview(it.id)}
              onDelete={() => handleDelete(it.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
