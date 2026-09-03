import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_ANSWER_LENGTH } from "../constants.js";
import useSpeechRecognition from "../hooks/useSpeechRecognition.js";
import styles from "./ChatInput.module.css";

// Join spoken text onto whatever was already in the box, with sensible spacing.
function appendSegment(existing, segment) {
  if (!existing) return segment;
  if (!segment) return existing;
  const sep = /\s$/.test(existing) ? "" : " ";
  return `${existing}${sep}${segment}`;
}

export default function ChatInput({ value, onChange, onSend, onSkip, disabled, placeholder }) {
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  // The draft text that was present when the current recording started. Speech
  // is appended after it, so re-recording doesn't clobber earlier text.
  const baseRef = useRef("");

  const handleTranscript = useCallback(
    (sessionText) => {
      const next = appendSegment(baseRef.current, sessionText).slice(0, MAX_ANSWER_LENGTH);
      onChange(next);
    },
    [onChange]
  );

  const { supported, listening, error, unavailable, start, stop } = useSpeechRecognition({
    onTranscript: handleTranscript,
  });

  // Voice is offered when the browser can do it and hasn't hit an unrecoverable
  // fault — but the candidate can always switch to typing.
  const canVoice = supported && !unavailable;
  const [preferType, setPreferType] = useState(false);
  const voiceMode = canVoice && !preferType;
  const hasText = value.trim().length > 0;

  // Stop the mic the moment the input locks (question sent / interview over), or
  // when the user switches to typing.
  useEffect(() => {
    if ((disabled || !voiceMode) && listening) stop();
  }, [disabled, voiceMode, listening, stop]);

  function startRecording() {
    baseRef.current = valueRef.current;
    start();
  }

  function handleMicClick() {
    if (listening) stop();
    else startRecording();
  }

  function switchToTyping() {
    if (listening) stop();
    setPreferType(true);
  }

  function switchToVoice() {
    setPreferType(false);
  }

  function send() {
    if (listening) stop();
    const trimmed = valueRef.current.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
  }

  // Move on to the next question now, whether or not anything's been answered.
  function skip() {
    if (disabled) return;
    if (listening) stop();
    onSkip();
  }

  // One action button: send the answer if there is one, otherwise skip ahead.
  function primaryAction() {
    if (hasText) send();
    else skip();
  }

  function handleKeyDown(e) {
    // Enter sends, Shift+Enter makes a newline. Ignore Enter while an IME
    // composition is active (Japanese/Chinese/Korean input etc.).
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (hasText) send();
    }
  }

  function clearAnswer() {
    if (listening) stop();
    baseRef.current = "";
    onChange("");
  }

  const textareaPlaceholder = voiceMode
    ? disabled
      ? placeholder
      : listening
      ? "Listening… speak your answer"
      : value
      ? "Tap the mic to add more, or press Send"
      : "Tap the mic and speak your answer — or switch to typing"
    : placeholder;

  return (
    <div className={styles.wrap}>
      <label className="sr-only" htmlFor="answer-input">
        Your answer
      </label>

      <div className={styles.field}>
        <textarea
          id="answer-input"
          className={styles.input}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={textareaPlaceholder}
          rows={2}
          maxLength={MAX_ANSWER_LENGTH}
          disabled={disabled}
          readOnly={voiceMode}
          aria-readonly={voiceMode}
        />

        {!disabled && (voiceMode || value || canVoice) && (
        <div className={styles.status}>
          {voiceMode && !disabled && listening && (
            <span className={styles.listening} role="status">
              <span className={styles.pulse} aria-hidden="true" />
              Listening…
            </span>
          )}
          {voiceMode && !disabled && !listening && (
            <span className={styles.hint}>
              {hasText
                ? "Done? Press Send to go to the next question."
                : "Tap the mic to answer, or Skip to move on."}
            </span>
          )}
          {value && !disabled && (
            <button type="button" className={styles.clear} onClick={clearAnswer}>
              Clear
            </button>
          )}
          {canVoice && !disabled && (
            <button
              type="button"
              className={styles.modeToggle}
              onClick={voiceMode ? switchToTyping : switchToVoice}
            >
              {voiceMode ? "Type instead" : "Use voice"}
            </button>
          )}
        </div>
        )}
      </div>

      {voiceMode && (
        <button
          type="button"
          className={`${styles.mic} ${listening ? styles.micOn : ""}`}
          onClick={handleMicClick}
          disabled={disabled}
          aria-pressed={listening}
          aria-label={listening ? "Stop recording" : "Start recording your answer"}
          title={listening ? "Stop recording" : "Speak your answer"}
        >
          <MicIcon />
        </button>
      )}

      <button
        className="btn-primary"
        onClick={primaryAction}
        disabled={disabled}
        title={hasText ? "Submit this answer" : "Move on without answering"}
      >
        {hasText ? "Send" : "Skip"}
      </button>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function MicIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="22" />
    </svg>
  );
}
