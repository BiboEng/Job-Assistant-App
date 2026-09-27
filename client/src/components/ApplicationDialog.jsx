import { useEffect, useId, useRef, useState } from "react";
import Icon from "./Icon.jsx";
import styles from "./ApplicationDialog.module.css";
import {
  APPLICATION_LIMITS,
  STAGES,
  emptyDraft,
  formatDay,
  fromLocalInputValue,
  stagePatch,
  toLocalInputValue,
  todayISO,
  validateApplication,
} from "../applications/applicationModel.js";

/**
 * The application modal, in two modes:
 *
 *   "add"  — a form for a job found anywhere else. Nothing is written until
 *            "Add application".
 *   "edit" — the detail view. Every field is live and saves on its own: text
 *            on blur (or Enter), selects and dates on change, so there is no
 *            Save button to forget. Closing commits anything still dirty.
 *
 * Built on the native <dialog> with showModal(): the browser supplies the
 * focus trap, the inert background, Escape, and focus return to the opener,
 * which is everything the Resume Builder's fullscreen layer had to do by hand.
 */

const TEXT_FIELDS = ["company", "jobTitle", "postingUrl", "notes"];

function pickDraft(app) {
  const base = emptyDraft();
  if (!app) return base;
  return Object.fromEntries(Object.keys(base).map((k) => [k, app[k] ?? base[k]]));
}

/** A text field's value as it would be saved: trimmed, except notes. */
function clean(key, value) {
  if (typeof value !== "string") return value;
  return key === "notes" ? value : value.trim();
}

export default function ApplicationDialog({ mode, application, onCreate, onUpdate, onDelete, onClose }) {
  const dialogRef = useRef(null);
  const pressStartedOnBackdrop = useRef(false);
  const uid = useId();
  const id = (name) => `${uid}-${name}`;

  const editing = mode === "edit";
  const [draft, setDraft] = useState(() => pickDraft(application));
  const [errors, setErrors] = useState({});
  const [saveState, setSaveState] = useState("idle"); // idle | saving | saved | error
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Open as a modal on mount; close on unmount so the backdrop can't outlive it.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  // The card was deleted elsewhere (another tab, a failed create rolled back).
  useEffect(() => {
    if (editing && !application) onClose?.();
  }, [editing, application, onClose]);

  const set = (key, value) => {
    setDraft((d) => ({ ...d, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  };

  /** Edit mode: write one or more fields if they differ from what's stored. */
  async function save(patch) {
    if (!editing || !application) return;
    const changed = {};
    for (const [key, value] of Object.entries(patch)) {
      if ((application[key] ?? null) !== (value ?? null)) changed[key] = value;
    }
    if (!Object.keys(changed).length) return;

    const fieldErrors = validateApplication(changed);
    if (Object.keys(fieldErrors).length) {
      setErrors((e) => ({ ...e, ...fieldErrors }));
      return;
    }
    setSaveState("saving");
    setFormError("");
    try {
      await onUpdate(changed);
      setSaveState("saved");
    } catch (err) {
      setSaveState("error");
      setFormError(err.message || "Couldn't save that change.");
    }
  }

  const commitText = (key) => save({ [key]: clean(key, draft[key]) });

  function changeStage(stage) {
    if (editing) {
      const patch = stagePatch(application, stage);
      setDraft((d) => ({ ...d, ...patch }));
      save(patch);
    } else {
      set("stage", stage);
    }
  }

  function changeAppliedOn(value) {
    set("appliedOn", value || null);
    save({ appliedOn: value || null });
  }

  function changeInterview(value) {
    const iso = fromLocalInputValue(value);
    set("interviewAt", iso);
    save({ interviewAt: iso });
  }

  /** Commit anything still being typed, then close. */
  function requestClose() {
    if (editing && application) {
      const pending = {};
      for (const key of TEXT_FIELDS) pending[key] = clean(key, draft[key]);
      // Drop fields that would fail validation (an emptied company, say):
      // closing keeps what's stored rather than saving something invalid.
      const invalid = validateApplication(pending);
      for (const key of Object.keys(invalid)) delete pending[key];
      save(pending);
    }
    onClose?.();
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const candidate = Object.fromEntries(
      Object.entries(draft).map(([k, v]) => [k, clean(k, v)])
    );
    const fieldErrors = validateApplication(candidate);
    if (Object.keys(fieldErrors).length) {
      setErrors(fieldErrors);
      const first = ["company", "jobTitle", "postingUrl"].find((k) => fieldErrors[k]);
      dialogRef.current?.querySelector(`#${CSS.escape(id(first))}`)?.focus();
      return;
    }
    if (candidate.stage !== "saved" && !candidate.appliedOn) candidate.appliedOn = todayISO();

    setSubmitting(true);
    setFormError("");
    try {
      await onCreate({ ...candidate, source: "manual" });
      onClose?.();
    } catch (err) {
      setFormError(err.message || "Couldn't add that application.");
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    setSubmitting(true);
    try {
      await onDelete();
      onClose?.();
    } catch (err) {
      setFormError(err.message || "Couldn't delete that application.");
      setSubmitting(false);
      setConfirmingDelete(false);
    }
  }

  // Edit mode: Enter in a single-line field commits it, by blurring. (In the
  // add form Enter submits, as a form should — validation catches a half-filled one.)
  const commitOnEnter = (e) => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      e.currentTarget.blur();
    }
  };

  const textProps = (key) => ({
    id: id(key),
    value: draft[key],
    onChange: (e) => set(key, e.target.value),
    onBlur: editing ? () => commitText(key) : undefined,
    "aria-invalid": errors[key] ? true : undefined,
    "aria-describedby": errors[key] ? id(`${key}-error`) : undefined,
  });

  const fieldError = (key) =>
    errors[key] ? (
      <span id={id(`${key}-error`)} className="field-error">
        {errors[key]}
      </span>
    ) : null;

  const origin = editing
    ? [
        application?.source === "job_matches" ? "From Job Matches" : "Added manually",
        application?.createdAt ? formatDay(todayISO(new Date(application.createdAt))) : "",
      ]
        .filter(Boolean)
        .join(" · ")
    : "";

  const Body = editing ? "div" : "form";

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby={id("title")}
      onCancel={(e) => {
        e.preventDefault();
        requestClose();
      }}
      // A click on the backdrop lands on the <dialog> itself (the panel
      // inside covers the rest). Require the press to start there too, so a
      // text selection dragged out of a field doesn't dismiss the dialog.
      onMouseDown={(e) => {
        pressStartedOnBackdrop.current = e.target === dialogRef.current;
      }}
      onClick={(e) => {
        if (e.target === dialogRef.current && pressStartedOnBackdrop.current) requestClose();
      }}
    >
      <Body className={styles.panel} {...(editing ? {} : { onSubmit: handleSubmit, noValidate: true })}>
        <header className={styles.head}>
          <div className={styles.headText}>
            {editing && <p className={`${styles.origin} eyebrow`}>{origin}</p>}
            <h2 id={id("title")} className={styles.title}>
              {editing ? application?.jobTitle || "Application" : "Add application"}
            </h2>
            {editing ? (
              <p className={styles.sub}>{application?.company}</p>
            ) : (
              <p className={styles.sub}>For a role you found outside Job Matches.</p>
            )}
          </div>
          <div className={styles.headActions}>
            {editing && (
              <span className={`${styles.saveState} mono`} role="status" aria-live="polite">
                {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : ""}
              </span>
            )}
            <button
              type="button"
              className={`btn-subtle ${styles.close}`}
              onClick={requestClose}
              aria-label="Close"
            >
              <Icon name="x" />
            </button>
          </div>
        </header>

        {formError && (
          <div className="error-banner" role="alert">
            {formError}
          </div>
        )}

        <div className={styles.grid}>
          <label className={`field ${styles.span2}`} htmlFor={id("jobTitle")}>
            <span className="field-label">Job title</span>
            <input
              {...textProps("jobTitle")}
              maxLength={APPLICATION_LIMITS.jobTitle}
              onKeyDown={editing ? commitOnEnter : undefined}
              autoComplete="off"
              autoFocus={!editing}
            />
            {fieldError("jobTitle")}
          </label>

          <label className={`field ${styles.span2}`} htmlFor={id("company")}>
            <span className="field-label">Company</span>
            <input
              {...textProps("company")}
              maxLength={APPLICATION_LIMITS.company}
              onKeyDown={editing ? commitOnEnter : undefined}
              autoComplete="organization"
            />
            {fieldError("company")}
          </label>

          <label className="field" htmlFor={id("stage")}>
            <span className="field-label">Stage</span>
            <select id={id("stage")} value={draft.stage} onChange={(e) => changeStage(e.target.value)}>
              {STAGES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>

          <label className="field" htmlFor={id("appliedOn")}>
            <span className="field-label">Application date</span>
            <input
              id={id("appliedOn")}
              type="date"
              value={draft.appliedOn || ""}
              onChange={(e) =>
                editing ? changeAppliedOn(e.target.value) : set("appliedOn", e.target.value || null)
              }
            />
          </label>

          <div className={`field ${styles.span2}`}>
            <label className="field-label" htmlFor={id("interviewAt")}>
              Interview <span className={styles.optional}>optional</span>
            </label>
            <div className={styles.inline}>
              <input
                id={id("interviewAt")}
                type="datetime-local"
                value={toLocalInputValue(draft.interviewAt)}
                onChange={(e) =>
                  editing
                    ? changeInterview(e.target.value)
                    : set("interviewAt", fromLocalInputValue(e.target.value))
                }
                aria-describedby={id("interview-hint")}
              />
              {draft.interviewAt && (
                <button
                  type="button"
                  className="btn-subtle btn-sm"
                  onClick={() => (editing ? changeInterview("") : set("interviewAt", null))}
                >
                  Clear
                </button>
              )}
            </div>
            <span id={id("interview-hint")} className="field-hint">
              Shown prominently on the card. No reminder is sent.
            </span>
          </div>

          <div className={`field ${styles.span2}`}>
            <label className="field-label" htmlFor={id("postingUrl")}>
              Link to the posting <span className={styles.optional}>optional</span>
            </label>
            <div className={styles.inline}>
              <input
                {...textProps("postingUrl")}
                type="url"
                inputMode="url"
                placeholder="https://"
                maxLength={APPLICATION_LIMITS.postingUrl}
                onKeyDown={editing ? commitOnEnter : undefined}
                autoComplete="off"
              />
              {editing && application?.postingUrl && (
                <a
                  className="btn-ghost"
                  href={application.postingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open
                  <Icon name="externalLink" />
                </a>
              )}
            </div>
            {fieldError("postingUrl")}
          </div>

          <label className={`field ${styles.span2}`} htmlFor={id("notes")}>
            <span className="field-label">Notes</span>
            <textarea
              {...textProps("notes")}
              rows={6}
              maxLength={APPLICATION_LIMITS.notes}
              placeholder="Recruiter, referral, salary range, what to prepare…"
            />
          </label>
        </div>

        <footer className={styles.foot}>
          {editing ? (
            confirmingDelete ? (
              <div className={styles.confirm} role="group" aria-label="Confirm delete">
                <span>Delete this application? This can’t be undone.</span>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => setConfirmingDelete(false)}
                  disabled={submitting}
                >
                  Keep it
                </button>
                <button type="button" className="btn-danger" onClick={handleDelete} disabled={submitting}>
                  Delete
                </button>
              </div>
            ) : (
              <>
                <button type="button" className="btn-danger" onClick={() => setConfirmingDelete(true)}>
                  <Icon name="trash" />
                  Delete
                </button>
                <button type="button" className="btn-primary" onClick={requestClose}>
                  Done
                </button>
              </>
            )
          ) : (
            <>
              <button type="button" className="btn-ghost" onClick={requestClose} disabled={submitting}>
                Cancel
              </button>
              <button type="submit" className="btn-primary" disabled={submitting}>
                {submitting ? "Adding…" : "Add application"}
              </button>
            </>
          )}
        </footer>
      </Body>
    </dialog>
  );
}
