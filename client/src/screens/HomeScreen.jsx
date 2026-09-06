import { useEffect, useState } from "react";
import InterviewCard from "../components/InterviewCard.jsx";
import { listInterviews, deleteInterview } from "../api/historyApi.js";
import styles from "./HomeScreen.module.css";

const STEPS = [
  "Paste a job description and pick how many questions you want.",
  "Answer each question by voice or text, against a per-question timer.",
  "Get a scored report — overall, per question, strengths and weak spots.",
];

export default function HomeScreen({ onStartNew, onOpenInterview, onFindJobs }) {
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
  const hasHistory = !loading && interviews.length > 0;

  return (
    <div className={styles.wrap}>
      <section className={styles.hero}>
        <h1 className={styles.title}>Practice interviews that fit the job</h1>
        <p className={styles.lede}>
          A mock interviewer asks questions tailored to a specific role, then
          scores your answers. Nothing is shared — your history stays in this
          browser.
        </p>
        <ol className={styles.steps}>
          {STEPS.map((s, i) => (
            <li key={i}>
              <span className={styles.stepNum} aria-hidden="true">
                {i + 1}
              </span>
              {s}
            </li>
          ))}
        </ol>
        <div className={styles.ctaRow}>
          <button className="btn-primary" onClick={onStartNew}>
            Start an interview
          </button>
          {onFindJobs && (
            <button className="btn-ghost" onClick={onFindJobs}>
              Find job matches
            </button>
          )}
        </div>
      </section>

      <section className={styles.historySection}>
        <div className={styles.header}>
          <h2 className={styles.heading}>Practice history</h2>
          {hasHistory && (
            <button className="btn-ghost" onClick={onStartNew}>
              New interview
            </button>
          )}
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

        {!loading && !hasHistory && !error && (
          <p className={styles.state}>
            No interviews yet — your completed interviews will show up here.
          </p>
        )}

        {hasHistory && (
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
      </section>
    </div>
  );
}
