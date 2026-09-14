import { useCallback, useEffect, useRef, useState } from "react";
import Icon from "./Icon.jsx";
import { MAX_ANSWER_LENGTH } from "../constants.js";
import useSpeechRecognition from "../hooks/useSpeechRecognition.js";
import styles from "./ChatInput.module.css";

const VOICE_NOTE_KEY = "mockInterview:voiceNoteSeen:v1";

// Join spoken text onto whatever was already in the box, with sensible spacing.
function appendSegment(existing, segment) {
  if (!existing) return segment;
  if (!segment) return existing;
  const sep = /\s$/.test(existing) ? "" : " ";
  return `${existing}${sep}${segment}`;
}

function readNoteSeen() {
  try {
    return localStorage.getItem(VOICE_NOTE_KEY) === "1";
  } catch {
    return false;
  }
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

  // The speech-provider disclosure used to sit permanently under the composer,
  // two lines of grey text on every single question. It's important the first
  // time and noise thereafter, so it's dismissible and remembered.
  const [noteSeen, setNoteSeen] = useState(readNoteSeen);
  function dismissNote() {
    setNoteSeen(true);
    try {
      localStorage.setItem(VOICE_NOTE_KEY, "1");
    } catch {
      // ignore — it'll just show again next session
    }
  }

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

  const textareaPlaceholder = disabled
    ? placeholder
    : voiceMode
    ? listening
      ? "Listening… speak your answer"
      : "Tap the mic and speak, or just start typing"
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
          rows={3}
          maxLength={MAX_ANSWER_LENGTH}
          disabled={disabled}
          // Editable whenever the mic isn't actively capturing — so a
          // transcription typo can be fixed without leaving voice mode.
          readOnly={voiceMode && listening}
          aria-readonly={voiceMode && listening}
          aria-describedby={voiceMode && !noteSeen ? "voice-note" : undefined}
        />

        <div className={styles.bar}>
          {/* One status line, not three: the placeholder covers "how", this
              covers "what's happening now". */}
          <div className={styles.status}>
            {!disabled && voiceMode && listening && (
              <span className={styles.listening} role="status">
                <span className={styles.pulse} aria-hidden="true" />
                Listening…
              </span>
            )}
            {!disabled && !listening && (
              <span className={styles.hint}>
                {hasText ? "Enter to send · Shift+Enter for a new line" : " "}
              </span>
            )}
            {!disabled && value && (
              <button type="button" className={styles.textBtn} onClick={clearAnswer}>
                Clear
              </button>
            )}
            {!disabled && canVoice && (
              <button
                type="button"
                className={styles.textBtn}
                onClick={voiceMode ? switchToTyping : switchToVoice}
              >
                {voiceMode ? "Type instead" : "Use voice"}
              </button>
            )}
          </div>

          <div className={styles.actions}>
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
                <Icon name="mic" size={19} />
              </button>
            )}

            {/* Skip is secondary. It used to inherit the primary button
                whenever the box was empty, which made "give up on this
                question" the loudest control on the screen. */}
            <button
              type="button"
              className="btn-ghost"
              onClick={skip}
              disabled={disabled}
              title="Move on without answering"
            >
              <Icon name="skipForward" size={15} />
              Skip
            </button>

            <button
              type="button"
              className="btn-primary"
              onClick={send}
              disabled={disabled || !hasText}
              title="Submit this answer"
            >
              <Icon name="send" size={15} />
              Send
            </button>
          </div>
        </div>
      </div>

      {error && (
        <p className={styles.error} role="alert">
          <Icon name="alert" size={15} />
          {error}
        </p>
      )}

      {!disabled && !supported && (
        <p className={styles.note}>
          Voice answers need Chrome or Edge — type your answer here instead.
        </p>
      )}

      {!disabled && voiceMode && !noteSeen && (
        <p className={styles.note} id="voice-note">
          <Icon name="alert" size={14} />
          <span>
            Voice uses your browser's speech recognition, which sends audio to its
            provider (Google, in Chrome) to transcribe. Switch to typing to keep it
            local.
          </span>
          <button
            type="button"
            className={styles.noteClose}
            onClick={dismissNote}
            aria-label="Dismiss voice privacy note"
          >
            <Icon name="x" size={14} />
          </button>
        </p>
      )}
    </div>
  );
}
