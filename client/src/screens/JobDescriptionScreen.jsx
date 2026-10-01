import { useEffect, useState } from "react";
import { startInterview } from "../api/interviewApi.js";
import Icon from "../components/Icon.jsx";
import SegmentedControl from "../components/SegmentedControl.jsx";
import { probeMediaPermission } from "../hooks/useDeliveryCapture.js";
import {
  MIN_JD_LENGTH,
  MAX_JD_LENGTH,
  MAX_INTERVIEW_RESUME_LENGTH,
  QUESTION_COUNT_MIN,
  QUESTION_COUNT_MAX,
  QUESTION_COUNT_DEFAULT,
  INTERVIEW_FOCUSES,
  INTERVIEW_MODES,
  DEFAULT_INTERVIEW_MODE,
} from "../constants.js";
import { roleHeadline } from "../utils/repeatInterview.js";
import UpgradeNotice from "../components/UpgradeNotice.jsx";
import { isPlanError } from "../billing/planErrors.js";
import { isExhausted, remainingLabel } from "../billing/usePlan.js";
import styles from "./JobDescriptionScreen.module.css";

const COUNT_OPTIONS = [];
for (let n = QUESTION_COUNT_MIN; n <= QUESTION_COUNT_MAX; n += 1) {
  COUNT_OPTIONS.push({ value: n, label: String(n) });
}

const MODE_OPTIONS = INTERVIEW_MODES.map((m) => ({
  value: m.value,
  label: m.label,
}));

const FOCUS_OPTIONS = INTERVIEW_FOCUSES.map((f) => ({
  value: f.value,
  label: f.short || f.label,
  hint: f.hint,
}));

/** ["a", "b", "c"] → "a, b and c" */
function listJoin(items) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function capitalise(text) {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

/**
 * The option lists with the plan's locks applied: an option the plan doesn't
 * include stays visible (so it can be discovered) but is disabled, with a
 * padlock and a hint naming the plan that has it. No `limits` (still loading,
 * or plans not switched on) locks nothing — the server has the final say.
 */
function withPlanLocks(limits) {
  if (!limits) return { count: COUNT_OPTIONS, mode: MODE_OPTIONS, focus: FOCUS_OPTIONS };
  const lock = (o, allowed, hint) =>
    allowed ? o : { ...o, disabled: true, locked: true, hint };
  return {
    count: COUNT_OPTIONS.map((o) =>
      lock(o, o.value <= limits.maxQuestions, `Up to ${limits.maxQuestions} questions on your plan. Pro allows up to 6.`)
    ),
    mode: MODE_OPTIONS.map((o) =>
      lock(o, o.value !== "speak" || limits.speakMode, "Speak mode is part of Pro and Ultimate.")
    ),
    focus: FOCUS_OPTIONS.map((o) =>
      lock(o, limits.focuses.includes(o.value), `${o.label} interviews are part of Pro and Ultimate.`)
    ),
  };
}

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

export default function JobDescriptionScreen({
  onStarted,
  onBack,
  limits = null,
  usage = null,
  onOpenPlans,
  onPlanError,
}) {
  const options = withPlanLocks(limits);
  const outOfInterviews = isExhausted(usage, "interviews");
  const interviewsLeft = remainingLabel(usage, "interviews", "interviews");
  // Anything the plan doesn't include, named once under the options.
  const lockedFeatures = limits
    ? [
        !limits.speakMode && "speak mode",
        limits.maxQuestions < QUESTION_COUNT_MAX && `${limits.maxQuestions + 1}–${QUESTION_COUNT_MAX} questions`,
        limits.focuses.length < INTERVIEW_FOCUSES.length && "Technical and System design interviews",
      ].filter(Boolean)
    : [];
  const [planError, setPlanError] = useState("");
  const [text, setText] = useState("");
  const [questionCount, setQuestionCount] = useState(QUESTION_COUNT_DEFAULT);
  const [focus, setFocus] = useState(INTERVIEW_FOCUSES[0].value);
  const [mode, setMode] = useState(DEFAULT_INTERVIEW_MODE);
  const [showResume, setShowResume] = useState(false);
  const [resume, setResume] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Speak mode is only actually selected once the hardware says yes. Until then
  // it's a request: `mode` shows what the candidate picked, `permission` shows
  // whether it can happen. "denied" reverts to typing and explains why.
  const [permission, setPermission] = useState("idle"); // idle | asking | ok | denied
  const [permissionError, setPermissionError] = useState("");

  const speakRequested = mode === "speak";
  const speakReady = speakRequested && permission === "ok";
  // What we'll actually send. Never "speak" without a working camera and mic.
  const effectiveMode = speakReady ? "speak" : "type";

  async function chooseMode(next) {
    setMode(next);
    setPermissionError("");
    if (next !== "speak") {
      setPermission("idle");
      return;
    }
    if (permission === "ok") return; // already granted this visit

    setPermission("asking");
    const { ok, error: mediaError } = await probeMediaPermission();
    if (ok) {
      setPermission("ok");
      return;
    }
    // Fall all the way back rather than leaving Speak selected but unusable —
    // the candidate should never reach question one and find out then.
    setPermission("denied");
    setPermissionError(mediaError);
    setMode("type");
  }

  // The plan can arrive after the form has rendered. If an option picked in
  // the meantime turns out to be locked, fall back to one the plan includes
  // rather than leaving a disabled choice selected.
  useEffect(() => {
    if (!limits) return;
    if (questionCount > limits.maxQuestions) setQuestionCount(limits.maxQuestions);
    if (!limits.focuses.includes(focus)) setFocus(limits.focuses[0] ?? "mixed");
    if (mode === "speak" && !limits.speakMode) chooseMode("type");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limits]);

  const trimmedLength = text.trim().length;
  const touched = trimmedLength > 0;
  const tooShort = trimmedLength < MIN_JD_LENGTH;
  const tooLong = trimmedLength > MAX_JD_LENGTH;
  const invalid = tooShort || tooLong;
  const showInvalid = touched && invalid;

  const focusMeta = INTERVIEW_FOCUSES.find((f) => f.value === focus);

  async function handleSubmit(e) {
    e.preventDefault();
    if (invalid || loading || outOfInterviews) return;

    setLoading(true);
    setError("");
    setPlanError("");
    try {
      const jd = text.trim();
      const data = await startInterview(jd, {
        questionCount,
        focus,
        resumeText: resume.trim() || undefined,
        mode: effectiveMode,
      });
      // The server doesn't echo the job description back, and the report needs
      // to be able to say which role it was for — so the setup screen, which is
      // the only place that has it, passes the headline along.
      onStarted({
        ...data,
        role: roleHeadline(jd),
        focus,
        // What "Practice again" on the results page will repeat.
        setup: { jobDescription: jd, questionCount, focus, mode: effectiveMode },
      });
    } catch (err) {
      if (isPlanError(err)) {
        setPlanError(err.message);
        onPlanError?.();
      } else {
        setError(err.message);
      }
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
      {/* This screen IS the whole setup — "Step 1 of 2" promised a second step
          that never existed. */}
      <header className="page-head">
        <div>
          <h1>New Interview</h1>
          <p className="page-sub">Paste the job you want. Every question is written for it.</p>
        </div>
        {!text && (
          <button
            type="button"
            className="btn-ghost"
            onClick={() => setText(SAMPLE_JD)}
            disabled={loading}
          >
            <Icon name="sparkles" />
            Use an example
          </button>
        )}
      </header>

      <form className={styles.card} onSubmit={handleSubmit}>
        <header className={styles.cardHead}>
          <h2 className={styles.heading}>Job description</h2>
          <p className={styles.sub}>
            {questionCount} question{questionCount === 1 ? "" : "s"}, tailored to this
            role.
          </p>
        </header>

        {error && (
          <div className="error-banner" role="alert">
            <Icon name="alert" />
            <span>{error}</span>
          </div>
        )}
        {planError && <UpgradeNotice message={planError} onOpenPlans={onOpenPlans} />}

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
                options={options.count}
                value={questionCount}
                onChange={setQuestionCount}
                ariaLabel="Number of questions"
                disabled={loading}
              />
            </div>
          </div>

          <div className={styles.optionField}>
            <span className={styles.optionLabel}>How you'll answer</span>
            <SegmentedControl
              options={options.mode}
              value={mode}
              onChange={chooseMode}
              ariaLabel="How you'll answer"
              disabled={loading || permission === "asking"}
            />
            <p className={styles.focusHint} role="status">
              {permission === "asking"
                ? "Waiting for camera and microphone permission…"
                : INTERVIEW_MODES.find((m) => m.value === mode)?.hint}
            </p>

            {/* Shown before the browser prompt, not after it: "why does this
                want my camera?" is a question to answer in advance. */}
            {speakRequested && permission !== "ok" && (
              <div className="info-banner">
                <Icon name="video" />
                {/* Precise on purpose: the media never leaves the browser, but
                    five summary numbers go with each answer, and the spoken
                    words are transcribed by the browser's speech service. */}
                <span>
                  We'll ask for your camera and microphone. Nothing is recorded:
                  pace, pauses and eye contact are measured in this browser, and
                  only those few numbers are sent with your answers. Your words
                  are transcribed by your browser's speech service (Google, in
                  Chrome).
                </span>
              </div>
            )}

            {speakReady && (
              <div className="info-banner">
                <Icon name="check" />
                <span>
                  Camera and microphone ready. The camera switches off the moment
                  the interview ends.
                </span>
              </div>
            )}

            {permission === "denied" && (
              <div className="warn-banner" role="status">
                <Icon name="alert" />
                <span>
                  {permissionError} Staying in typing mode — your answers will be
                  scored on content as usual.
                </span>
              </div>
            )}
          </div>

          <div className={styles.optionField}>
            <span className={styles.optionLabel}>Focus</span>
            <SegmentedControl
              options={options.focus}
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
              <Icon name="plus" />
              Add your resume (optional)
            </button>
          )}

          {lockedFeatures.length > 0 && (
            <UpgradeNotice
              compact
              message={`${capitalise(listJoin(lockedFeatures))} ${
                lockedFeatures.length === 1 ? "is" : "are"
              } part of Pro and Ultimate.`}
              onOpenPlans={onOpenPlans}
            />
          )}
        </fieldset>

        {outOfInterviews && (
          <UpgradeNotice
            message="You've used today's interviews. The count resets at midnight UTC, or upgrade for more a day."
            onOpenPlans={onOpenPlans}
          />
        )}

        <div className={styles.footer}>
          <span className={styles.summary}>
            {questionCount} question{questionCount === 1 ? "" : "s"} ·{" "}
            {focusMeta?.short || focusMeta?.label} ·{" "}
            {effectiveMode === "speak" ? "spoken" : "typed"}
            {resume.trim() ? " · with your resume" : ""}
            {interviewsLeft && (
              <span className={styles.remaining}>
                {" · "}
                {interviewsLeft}
              </span>
            )}
          </span>
          <button
            type="submit"
            className="btn-primary"
            disabled={invalid || loading || outOfInterviews}
          >
            {loading ? (
              "Starting…"
            ) : (
              <>
                Start interview
                <Icon name="chevronRight" />
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
