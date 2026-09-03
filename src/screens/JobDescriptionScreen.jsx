import { useState } from "react";
import { startInterview } from "../api/interviewApi.js";
import { MIN_JD_LENGTH, MAX_JD_LENGTH } from "../constants.js";
import styles from "./JobDescriptionScreen.module.css";

export default function JobDescriptionScreen({ onStarted, onBack }) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const trimmedLength = text.trim().length;
  const tooShort = trimmedLength < MIN_JD_LENGTH;
  const tooLong = trimmedLength > MAX_JD_LENGTH;
  const invalid = tooShort || tooLong;

  async function handleSubmit(e) {
    e.preventDefault();
    if (invalid || loading) return;

    setLoading(true);
    setError("");
    try {
      const data = await startInterview(text.trim());
      onStarted(data);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  }

  let hint;
  if (tooShort) hint = `At least ${MIN_JD_LENGTH} characters`;
  else if (tooLong) hint = `Too long — remove ${trimmedLength - MAX_JD_LENGTH} characters`;
  else hint = `${trimmedLength} characters`;

  return (
    <div className={styles.wrap}>
      {onBack && (
        <button type="button" className={`btn-ghost ${styles.back}`} onClick={onBack}>
          ← Back to home
        </button>
      )}

      <form className={styles.card} onSubmit={handleSubmit}>
        <h2 className={styles.heading} id="jd-heading">
          Paste the job description
        </h2>
        <p className={styles.sub}>
          The interviewer will ask 3 questions tailored to this role.
        </p>

        {error && (
          <div className="error-banner" role="alert">
            {error}
          </div>
        )}

        <label className="sr-only" htmlFor="jd-input">
          Job description
        </label>
        <textarea
          id="jd-input"
          className={styles.textarea}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. We're hiring a Senior Frontend Engineer to lead our design system work..."
          rows={12}
          maxLength={MAX_JD_LENGTH + 500}
          aria-invalid={invalid && trimmedLength > 0}
          aria-describedby="jd-hint"
          disabled={loading}
        />

        <div className={styles.footer}>
          <span className={styles.count} id="jd-hint">
            {hint}
          </span>
          <button type="submit" className="btn-primary" disabled={invalid || loading}>
            {loading ? "Starting…" : "Start interview"}
          </button>
        </div>
      </form>
    </div>
  );
}
