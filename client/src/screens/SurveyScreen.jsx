import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "../components/Icon.jsx";
import { SURVEY_QUESTIONS, TOTAL_QUESTIONS } from "../survey/surveyQuestions.js";
import { fetchSurvey, saveSurvey } from "../survey/surveyApi.js";
import { emptyAnswers, hasAnyAnswer } from "../survey/surveyMapping.js";
import { useAuth } from "../auth/AuthProvider.jsx";
import styles from "./SurveyScreen.module.css";

/**
 * The career survey: one question per screen, Next to advance, fifteen in all.
 * Every question is optional — Next is always enabled, and skipping is just
 * pressing it without answering.
 *
 * Two ways out, and both keep what's been typed:
 *   - Submit, on the last question → status "completed".
 *   - "Save & exit", on any question → status "dismissed", with the answers so
 *     far stored so returning resumes where they left off.
 * Leaving with nothing filled in at all writes nothing, so a user who opens the
 * survey out of curiosity and backs out still sees the banner.
 *
 * Revisiting from the account menu prefills from the stored row and saves over
 * it — the table holds one row per user, not a history.
 *
 * The question is the `<h1>`: there is only one thing on the screen, so it
 * should be the thing the page is about, and focus moves to it on every
 * advance. The option group is labelled by it rather than by a `<legend>`,
 * which is why there's no `<fieldset>` here any more — a fieldset around a
 * single control group whose label is already the page heading is a second
 * name for the same thing.
 *
 * The answers are written to Supabase and read back only here. Nothing in
 * server/ knows this data exists, so no AI prompt — interview questions,
 * feedback, the resume builder, job matching — can see it. That is deliberate
 * and documented in CLAUDE.md; wiring it into the model is a separate job.
 */

const HEADING_ID = "survey-question-heading";

export default function SurveyScreen({ onDone, onExit }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const [answers, setAnswers] = useState(emptyAnswers);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [index, setIndex] = useState(0);
  const [saving, setSaving] = useState(null); // null | "completed" | "dismissed"
  const [saveError, setSaveError] = useState("");

  const headingRef = useRef(null);
  const firstRenderRef = useRef(true);

  useEffect(() => {
    if (!userId) return undefined;
    let cancelled = false;
    setLoading(true);
    setLoadError("");
    fetchSurvey(userId)
      .then((result) => {
        if (cancelled) return;
        if (!result.available) {
          setLoadError(
            "The survey isn't set up on this project yet — the user_survey_responses table is missing."
          );
        } else {
          setAnswers(result.answers);
        }
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err.message || "Couldn't load your answers.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // The whole screen changes on every Next, so focus has to follow it or a
  // keyboard user is left on a Next button that now belongs to a question they
  // can't see. Skipped on first render: stealing focus on arrival is its own
  // annoyance.
  useEffect(() => {
    if (firstRenderRef.current) {
      firstRenderRef.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [index]);

  const question = SURVEY_QUESTIONS[index];
  const isLast = index === TOTAL_QUESTIONS - 1;
  const busy = saving !== null;

  const answeredCount = useMemo(() => countAnswered(answers), [answers]);

  function set(column, value) {
    setAnswers((prev) => ({ ...prev, [column]: value }));
  }

  function toggleMulti(column, value) {
    setAnswers((prev) => {
      const current = Array.isArray(prev[column]) ? prev[column] : [];
      return {
        ...prev,
        [column]: current.includes(value)
          ? current.filter((v) => v !== value)
          : [...current, value],
      };
    });
  }

  /**
   * A single-select behaves as a toggle: clicking the chosen option clears it.
   * Every question is optional, and without this there's no way back to "no
   * answer" once one has been given by mistake.
   */
  function toggleSingle(column, value) {
    setAnswers((prev) => ({ ...prev, [column]: prev[column] === value ? "" : value }));
  }

  function goNext() {
    setIndex((i) => Math.min(TOTAL_QUESTIONS - 1, i + 1));
  }

  function goBack() {
    setIndex((i) => Math.max(0, i - 1));
  }

  async function persist(status) {
    if (!userId || busy) return;
    setSaving(status);
    setSaveError("");
    try {
      await saveSurvey(userId, answers, status);
      onDone?.(status);
    } catch (err) {
      setSaveError(err.message || "Could not save your answers.");
      setSaving(null);
    }
  }

  function handleExit() {
    // Nothing filled in — don't write a row on the way out. The user opened the
    // form and changed their mind; that isn't a dismissal.
    if (!hasAnyAnswer(answers)) {
      onExit?.();
      return;
    }
    persist("dismissed");
  }

  if (loadError) {
    return (
      <div className={styles.wrap}>
        <div className="error-banner" role="alert">
          <Icon name="alert" size={16} />
          <span>{loadError}</span>
        </div>
        <div>
          <button type="button" className="btn-ghost" onClick={onExit}>
            <Icon name="arrowLeft" size={15} />
            Back to dashboard
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className={styles.wrap} aria-busy="true">
        <div className={`skeleton ${styles.skelHeader}`} />
        <div className={`skeleton ${styles.skelCard}`} />
        <p className="sr-only">Loading the survey…</p>
      </div>
    );
  }

  const percent = Math.round(((index + 1) / TOTAL_QUESTIONS) * 100);

  return (
    <div className={styles.wrap}>
      <div className={styles.progress}>
        <div className={styles.progressMeta}>
          <p className="eyebrow">Career survey · {question.section}</p>
          <p className={styles.progressText}>
            Question {index + 1} of {TOTAL_QUESTIONS}
            {answeredCount > 0 && ` · ${answeredCount} answered`}
          </p>
        </div>
        {/* The bar is decorative — the count above it is the accessible
            version, and a progressbar role here would just say it twice. */}
        <div className={styles.track} aria-hidden="true">
          <div className={styles.fill} style={{ width: `${percent}%` }} />
        </div>
      </div>

      {/* Keyed on the question, so each advance replays the enter animation and
          React rebuilds the controls rather than reusing a text input across
          two different questions — which would otherwise carry a caret, and a
          stale IME composition, from one to the next. */}
      <div key={question.id} className={styles.card}>
        <h1 ref={headingRef} tabIndex={-1} id={HEADING_ID} className={styles.question}>
          {question.label}
        </h1>

        <p className={styles.optional}>
          {question.type === "multi"
            ? "Choose any that apply — or none."
            : "Optional. Skip it with Next if you'd rather not say."}
        </p>

        <QuestionBody
          question={question}
          answers={answers}
          disabled={busy}
          onSet={set}
          onToggleSingle={toggleSingle}
          onToggleMulti={toggleMulti}
        />
      </div>

      {saveError && (
        <div className="error-banner" role="alert">
          <Icon name="alert" size={16} />
          <span>{saveError}</span>
        </div>
      )}

      <div className={styles.controls}>
        <div className={styles.controlsLeft}>
          <button
            type="button"
            className="btn-ghost"
            onClick={goBack}
            disabled={index === 0 || busy}
          >
            <Icon name="arrowLeft" size={15} />
            Back
          </button>
        </div>

        <div className={styles.controlsRight}>
          <button type="button" className="btn-subtle" onClick={handleExit} disabled={busy}>
            {saving === "dismissed" ? "Saving…" : "Save & exit"}
          </button>

          {isLast ? (
            <button
              type="button"
              className="btn-primary"
              onClick={() => persist("completed")}
              disabled={busy}
            >
              {saving === "completed" ? "Submitting…" : "Submit"}
              <Icon name="check" size={15} />
            </button>
          ) : (
            <button type="button" className="btn-primary" onClick={goNext} disabled={busy}>
              Next
              <Icon name="chevronRight" size={15} />
            </button>
          )}
        </div>
      </div>

      <p className={styles.note}>
        <Icon name="lock" size={14} />
        <span>
          Your answers are stored on your account and are only used to shape the
          product. They aren't used by the interviewer, the feedback, the resume
          builder or job matching.
        </span>
      </p>
    </div>
  );
}

/* --- one question ----------------------------------------------------------- */

function QuestionBody({
  question,
  answers,
  disabled,
  onSet,
  onToggleSingle,
  onToggleMulti,
}) {
  const value = answers[question.column];

  if (question.type === "text") {
    return (
      <TextQuestion
        question={question}
        answers={answers}
        disabled={disabled}
        onSet={onSet}
      />
    );
  }

  const multi = question.type === "multi";
  const selected = multi ? (Array.isArray(value) ? value : []) : [];
  const followUpOpen = question.followUp && value === question.followUp.when;

  return (
    <>
      {/* A role="radio" is only meaningful inside a radiogroup, and a set of
          checkboxes needs a group to be announced as one. The heading names
          both, so there's no separate legend to fall out of sync with it. */}
      <div
        className={styles.options}
        role={multi ? "group" : "radiogroup"}
        aria-labelledby={HEADING_ID}
      >
        {question.options.map((o) => {
          const checked = multi ? selected.includes(o.value) : value === o.value;
          return (
            <button
              key={o.value}
              type="button"
              role={multi ? "checkbox" : "radio"}
              aria-checked={checked}
              disabled={disabled}
              className={`${styles.chip} ${checked ? styles.chipOn : ""}`}
              onClick={() =>
                multi
                  ? onToggleMulti(question.column, o.value)
                  : onToggleSingle(question.column, o.value)
              }
            >
              <span className={styles.chipMark} aria-hidden="true">
                {checked && <Icon name="check" size={13} />}
              </span>
              {o.label}
            </button>
          );
        })}
      </div>

      {followUpOpen && (
        <FollowUp
          field={question.followUp}
          value={answers[question.followUp.column] || ""}
          disabled={disabled}
          onChange={(v) => onSet(question.followUp.column, v)}
        />
      )}
    </>
  );
}

function FollowUp({ field, value, disabled, onChange }) {
  return (
    <label className={styles.followUp}>
      <span className={styles.followUpLabel}>{field.label}</span>
      {field.multiline ? (
        <textarea
          className={styles.textarea}
          value={value}
          maxLength={field.maxLength}
          placeholder={field.placeholder}
          disabled={disabled}
          rows={2}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          type="text"
          className={styles.input}
          value={value}
          maxLength={field.maxLength}
          placeholder={field.placeholder}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </label>
  );
}

function TextQuestion({ question, answers, disabled, onSet }) {
  const value = answers[question.column] || "";
  const optedOut = question.optOut ? answers[question.optOut.column] === true : false;
  const locked = disabled || optedOut;

  // Labelled by the heading, which is the question — a visible <label> here
  // would repeat it word for word.
  const shared = {
    "aria-labelledby": HEADING_ID,
    className: question.multiline ? styles.textarea : styles.input,
    value: optedOut ? "" : value,
    maxLength: question.maxLength,
    placeholder: question.placeholder,
    disabled: locked,
    onChange: (e) => onSet(question.column, e.target.value),
  };

  return (
    <div className={styles.textQuestion}>
      {question.multiline ? (
        <textarea {...shared} rows={4} />
      ) : (
        <input type="text" {...shared} />
      )}

      {question.optOut && (
        <label className={styles.optOut}>
          <input
            type="checkbox"
            checked={optedOut}
            disabled={disabled}
            onChange={(e) => {
              onSet(question.optOut.column, e.target.checked);
              // Clear the field on opt-out, so the stored row can't say both
              // "prefer not to say" and a number.
              if (e.target.checked) onSet(question.column, "");
            }}
          />
          <span>{question.optOut.label}</span>
        </label>
      )}
    </div>
  );
}

/* --- helpers ---------------------------------------------------------------- */

/** How many of the fifteen have an answer — the follow-ups don't count. */
function countAnswered(answers) {
  let n = 0;
  for (const q of SURVEY_QUESTIONS) {
    const value = answers[q.column];
    if (q.type === "multi") {
      if (Array.isArray(value) && value.length > 0) n += 1;
    } else if (typeof value === "string" && value.trim()) {
      n += 1;
    } else if (q.optOut && answers[q.optOut.column] === true) {
      // Declining to answer is an answer.
      n += 1;
    }
  }
  return n;
}
