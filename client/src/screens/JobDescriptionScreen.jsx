import { useState } from "react";
import { startInterview } from "../api/interviewApi.js";
import {
  MIN_JD_LENGTH,
  MAX_JD_LENGTH,
  MAX_INTERVIEW_RESUME_LENGTH,
  QUESTION_COUNT_MIN,
  QUESTION_COUNT_MAX,
  QUESTION_COUNT_DEFAULT,
  INTERVIEW_FOCUSES,
} from "../constants.js";
import styles from "./JobDescriptionScreen.module.css";

const COUNT_OPTIONS = [];
for (let n = QUESTION_COUNT_MIN; n <= QUESTION_COUNT_MAX; n += 1) {
  COUNT_OPTIONS.push(n);
}

export default function JobDescriptionScreen({ onStarted, onBack }) {
  const [text, setText] = useState("");
  const [questionCount, setQuestionCount] = useState(QUESTION_COUNT_DEFAULT);
  const [focus, setFocus] = useState(INTERVIEW_FOCUSES[0].value);
  const [showResume, setShowResume] = useState(false);
  const [resume, setResume] = useState("");
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
      const data = await startInterview(text.trim(), {
        questionCount,
        focus,
        resumeText: resume.trim() || undefined,
      });
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
          The interviewer asks {questionCount} question
          {questionCount === 1 ? "" : "s"} tailored to this role.
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
        <span className={styles.count} id="jd-hint">
          {hint}
        </span>

        <fieldset className={styles.options} disabled={loading}>
          <legend className={styles.optionsLegend}>Interview options</legend>

          <div className={styles.optionRow}>
            <label className={styles.optionField}>
              <span className={styles.optionLabel}>Questions</span>
              <select
                className={styles.select}
                value={questionCount}
                onChange={(e) => setQuestionCount(Number(e.target.value))}
              >
                {COUNT_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>

            <label className={styles.optionField}>
              <span className={styles.optionLabel}>Focus</span>
              <select
                className={styles.select}
                value={focus}
                onChange={(e) => setFocus(e.target.value)}
              >
                {INTERVIEW_FOCUSES.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {showResume ? (
            <div className={styles.resumeBlock}>
              <label className={styles.optionLabel} htmlFor="resume-paste">
                Your resume (optional) — helps the interviewer ask about your
                actual background
              </label>
              <textarea
                id="resume-paste"
                className={styles.resumeArea}
                value={resume}
                onChange={(e) =>
                  setResume(e.target.value.slice(0, MAX_INTERVIEW_RESUME_LENGTH))
                }
                placeholder="Paste the text of your resume…"
                rows={6}
              />
              <div className={styles.resumeFoot}>
                <span className={styles.count}>
                  {resume.trim().length}/{MAX_INTERVIEW_RESUME_LENGTH}
                </span>
                <button
                  type="button"
                  className={styles.linkBtn}
                  onClick={() => {
                    setResume("");
                    setShowResume(false);
                  }}
                >
                  Remove
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className={styles.linkBtn}
              onClick={() => setShowResume(true)}
            >
              + Add your resume (optional)
            </button>
          )}
        </fieldset>

        <div className={styles.footer}>
          <span className={styles.count}>
            {focus === "mixed"
              ? "Behavioral + technical mix"
              : INTERVIEW_FOCUSES.find((f) => f.value === focus)?.label}
          </span>
          <button type="submit" className="btn-primary" disabled={invalid || loading}>
            {loading ? "Starting…" : "Start interview"}
          </button>
        </div>
      </form>
    </div>
  );
}
