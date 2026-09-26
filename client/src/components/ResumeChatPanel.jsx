import { useEffect, useRef, useState } from "react";
import Icon from "./Icon.jsx";
import { RESUME_MAX_MESSAGE_LENGTH } from "../constants.js";
import styles from "./ResumeChatPanel.module.css";

const SUGGESTIONS = [
  "I'm a frontend developer with 4 years' experience — help me start",
  "Make my summary shorter and more specific",
  "Rewrite my bullets to lead with impact",
  "Tailor this resume for a senior role",
];

/**
 * The left half of the Resume Builder: the conversation with the AI.
 *
 * While a turn is in flight (`busy`) the Send button becomes a Stop button. The
 * parent owns what Stop actually does — this component only reports the click.
 */
export default function ResumeChatPanel({
  messages,
  busy,
  error,
  onSend,
  onStop,
  onRetry,
}) {
  const [draft, setDraft] = useState("");
  const listRef = useRef(null);
  const textareaRef = useRef(null);

  // Keep the newest message in view as the conversation grows.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy]);

  // Return focus to the composer when the AI finishes, so the user can keep
  // typing without reaching for the mouse.
  useEffect(() => {
    if (!busy) textareaRef.current?.focus();
  }, [busy]);

  function submit(e) {
    e?.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    onSend(text);
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  function useSuggestion(text) {
    if (busy) return;
    onSend(text);
  }

  const canSend = draft.trim().length > 0 && !busy;
  const showSuggestions = messages.filter((m) => m.role === "user").length === 0;

  return (
    <div className={styles.panel}>
      <div className={styles.messages} ref={listRef}>
        {messages.map((m) =>
          m.role === "note" ? (
            <p key={m.id} className={styles.note} role="status">
              {m.text}
            </p>
          ) : (
            <div
              key={m.id}
              className={`${styles.message} ${
                m.role === "user" ? styles.user : styles.assistant
              }`}
            >
              <span className={styles.role}>
                {m.role === "user" ? "You" : "Resume assistant"}
              </span>
              {/* Model output is rendered as text, never HTML. */}
              <p className={styles.text}>{m.text}</p>
            </div>
          )
        )}

        {busy && (
          <div className={`${styles.message} ${styles.assistant}`} aria-hidden="true">
            <span className={styles.role}>Resume assistant</span>
            <p className={styles.typing}>
              <span className={styles.dot} />
              <span className={styles.dot} />
              <span className={styles.dot} />
            </p>
          </div>
        )}

        {showSuggestions && !busy && (
          <div className={styles.suggestions}>
            <p className={styles.suggestionLabel}>Try one of these</p>
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                className={styles.suggestion}
                onClick={() => useSuggestion(s)}
              >
                <Icon name="sparkles" />
                <span>{s}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {error && (
        <div className={`error-banner ${styles.error}`} role="alert">
          <Icon name="alert" />
          <span>{error}</span>
          {onRetry && (
            <button type="button" className="btn-ghost" onClick={onRetry}>
              Try again
            </button>
          )}
        </div>
      )}

      <form className={styles.composer} onSubmit={submit}>
        <label className="sr-only" htmlFor="resume-chat-input">
          Message the resume assistant
        </label>
        <textarea
          id="resume-chat-input"
          ref={textareaRef}
          className={styles.input}
          value={draft}
          onChange={(e) => setDraft(e.target.value.slice(0, RESUME_MAX_MESSAGE_LENGTH))}
          onKeyDown={handleKeyDown}
          placeholder={
            busy
              ? "The assistant is writing…"
              : "Tell the assistant about your experience, or ask for a change"
          }
          rows={3}
          maxLength={RESUME_MAX_MESSAGE_LENGTH}
          disabled={busy}
        />

        <div className={styles.composerBar}>
          <span className={styles.hint}>
            {busy ? "Editing is locked while the assistant writes." : "Enter to send"}
          </span>

          {busy ? (
            <button type="button" className={styles.stopBtn} onClick={onStop}>
              <Icon name="stop" />
              Stop
            </button>
          ) : (
            <button type="submit" className="btn-primary" disabled={!canSend}>
              <Icon name="send" />
              Send
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
