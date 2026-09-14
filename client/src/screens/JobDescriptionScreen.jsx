import { useState } from "react";
import { startInterview } from "../api/interviewApi.js";
import Icon from "../components/Icon.jsx";
import SegmentedControl from "../components/SegmentedControl.jsx";
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
  COUNT_OPTIONS.push({ value: n, label: String(n) });
}

const FOCUS_OPTIONS = INTERVIEW_FOCUSES.map((f) => ({
  value: f.value,
  label: f.short || f.label,
  hint: f.hint,
}));

// Offered as a one-click filler so someone who wants to try the app doesn't
// have to go and find a real posting first.
const SAMPLE_JD = `Senior Frontend Engineer — Design Systems

We're looking for a senior frontend engineer to own our design system and the component library that ~40 engineers build on every day.

What you'll do
- Design, build and document accessible React components used across six product surfaces.
- Drive the migration from our legacy CSS to design tokens, without freezing product work.
- Partner with design on the specification of new patterns, and push back when a pattern doesn't earn its place.
- Own the library's release process, versioning and adoption metrics.

What we're looking for
- 5+ years building production frontend, with deep React and modern CSS.
- Demonstrated experience owning a shared library or platform used by other engineers.
- A high bar for accessibility — you know what WCAG AA actually requires in practice.
- Strong written communication; much of this role is documentation and persuasion.

Nice to have: TypeScript, Storybook, visual regression testing, prior design-system work at scale.`;

export default function JobDescriptionScreen({ onStarted, onBack }) {
  const [text, setText] = useState("");
  const [questionCount, setQuestionCount] = useState(QUESTION_COUNT_DEFAULT);
  const [focus, setFocus] = useState(INTERVIEW_FOCUSES[0].value);
  const [showResume, setShowResume] = useState(false);
  const [resume, setResume] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const trimmedLength = text.trim().length;
  const touched = trimmedLength > 0;
  const tooShort = trimmedLength < MIN_JD_LENGTH;
  const tooLong = trimmedLength > MAX_JD_LENGTH;
  const invalid = tooShort || tooLong;
  const showInvalid = touched && invalid;

  const focusMeta = INTERVIEW_FOCUSES.find((f) => f.value === focus);

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
  if (tooShort && touched) hint = `${MIN_JD_LENGTH - trimmedLength} more characters needed`;
  else if (tooShort) hint = `At least ${MIN_JD_LENGTH} characters`;
  else if (tooLong) hint = `Too long — remove ${trimmedLength - MAX_JD_LENGTH} characters`;
  else hint = `${trimmedLength.toLocaleString()} characters`;

  return (
    <div className={styles.wrap}>
      {onBack && (
        <button type="button" className={`btn-ghost btn-sm ${styles.back}`} onClick={onBack}>
          <Icon name="arrowLeft" size={15} />
          Back to home
        </button>
      )}

      <form className={styles.card} onSubmit={handleSubmit}>
        <header className={styles.cardHead}>
          <div>
            <p className="eyebrow">Step 1 of 2</p>
            <h2 className={styles.heading}>Paste the job description</h2>
            <p className={styles.sub}>
              The interviewer will ask {questionCount} question
              {questionCount === 1 ? "" : "s"} tailored to this role.
            </p>
          </div>
          {!text && (
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={() => setText(SAMPLE_JD)}
              disabled={loading}
            >
              <Icon name="sparkles" size={15} />
              Use an example
            </button>
          )}
        </header>

        {error && (
          <div className="error-banner" role="alert">
            <Icon name="alert" size={16} />
            <span>{error}</span>
          </div>
        )}

        <label className="sr-only" htmlFor="jd-input">
          Job description
        </label>
        <textarea
          id="jd-input"
          className={`${styles.textarea} ${showInvalid ? styles.textareaInvalid : ""}`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. We're hiring a Senior Frontend Engineer to lead our design system work…"
          rows={12}
          maxLength={MAX_JD_LENGTH + 500}
          aria-invalid={showInvalid}
          aria-describedby="jd-hint"
          disabled={loading}
        />
        <div className={styles.hintRow}>
          <span
            className={`${styles.count} ${showInvalid ? styles.countInvalid : ""}`}
            id="jd-hint"
          >
            {hint}
          </span>
          {text && !loading && (
            <button type="button" className={styles.clearBtn} onClick={() => setText("")}>
              Clear
            </button>
          )}
        </div>

        <fieldset className={styles.options} disabled={loading}>
          <legend className={`eyebrow ${styles.optionsLegend}`}>Interview options</legend>

          <div className={styles.optionRow}>
            <div className={styles.optionField}>
              <span className={styles.optionLabel}>Questions</span>
              <SegmentedControl
                options={COUNT_OPTIONS}
                value={questionCount}
                onChange={setQuestionCount}
                ariaLabel="Number of questions"
                disabled={loading}
              />
            </div>
          </div>

          <div className={styles.optionField}>
            <span className={styles.optionLabel}>Focus</span>
            <SegmentedControl
              options={FOCUS_OPTIONS}
              value={focus}
              onChange={setFocus}
              ariaLabel="Interview focus"
              disabled={loading}
            />
            {/* The label alone doesn't say what you'll actually be asked. */}
            <p className={styles.focusHint} role="status">
              {focusMeta?.hint}
            </p>
          </div>

          {showResume ? (
            <div className={styles.resumeBlock}>
              <label className={styles.optionLabel} htmlFor="resume-paste">
                Your resume <span className={styles.optional}>(optional)</span>
              </label>
              <p className={styles.resumeNote}>
                Helps the interviewer ask about your actual background.
              </p>
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
                  {resume.trim().length.toLocaleString()}/
                  {MAX_INTERVIEW_RESUME_LENGTH.toLocaleString()}
                </span>
                <button
                  type="button"
                  className={styles.clearBtn}
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
              className={styles.addResume}
              onClick={() => setShowResume(true)}
            >
              <Icon name="plus" size={15} />
              Add your resume (optional)
            </button>
          )}
        </fieldset>

        <div className={styles.footer}>
          <span className={styles.summary}>
            {questionCount} question{questionCount === 1 ? "" : "s"} ·{" "}
            {focusMeta?.short || focusMeta?.label}
            {resume.trim() ? " · with your resume" : ""}
          </span>
          <button type="submit" className="btn-primary" disabled={invalid || loading}>
            {loading ? (
              "Starting…"
            ) : (
              <>
                Start interview
                <Icon name="chevronRight" size={16} />
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
