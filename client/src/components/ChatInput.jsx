import { useCallback, useEffect, useRef, useState } from "react";
import Icon from "./Icon.jsx";
import { MAX_ANSWER_LENGTH } from "../constants.js";
import useSpeechRecognition from "../hooks/useSpeechRecognition.js";
import styles from "./ChatInput.module.css";

const VOICE_NOTE_KEY = "mockInterview:voiceNoteSeen:v1";

// Ceiling for the auto-growing composer — about 12 lines, past which it scrolls
// rather than pushing the question off the top of the screen.
const MAX_TEXTAREA_PX = 260;

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

/**
 * @param {object} props
 * @param {boolean} [props.speakMode]  the interview is in Speak mode: voice is
 *   the expected way to answer, so typing isn't offered as an equal alternative
 *   (it stays available as a fallback). Type mode behaves exactly as it always has.
 * @param {(recording: boolean) => void} [props.onRecordingChange]  fires on every
 *   transition of the microphone, so the delivery capture can measure exactly
 *   the stretch the candidate was actually being recorded for.
 */
export default function ChatInput({
  value,
  onChange,
  onSend,
  onSkip,
  disabled,
  placeholder,
  speakMode = false,
  onRecordingChange,
}) {
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  // The box grows with the answer instead of scrolling three lines at a time.
  // An interview answer is a paragraph; a fixed rows={3} meant most of what you
  // had written was out of sight while you wrote the rest of it.
  const textareaRef = useRef(null);
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_TEXTAREA_PX)}px`;
  }, [value]);

  // The draft text that was present when the current recording started. Speech
  // is appended after it, so re-recording doesn't clobber earlier text.
  const baseRef = useRef("");

  // The engine emits one last time from `onend`, after `stop()` — it folds in
  // whatever audio hadn't been finalised yet. That flush is wanted when the user
  // simply stops the mic (they keep the words and can edit them), but not when
  // the answer has just been submitted: it arrives *after* the draft is cleared
  // and re-fills the composer with the answer that was already sent, which then
  // bleeds into the next question.
  const acceptTranscriptRef = useRef(true);

  const handleTranscript = useCallback(
    (sessionText) => {
      if (!acceptTranscriptRef.current) return;
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
  //
  // `speakMode` decides which one they START in. Type mode used to be a label on
  // the setup screen and nothing more: the composer opened mic-first, told them
  // to "tap the mic and speak", and showed the speech-provider disclosure, for
  // someone who had just explicitly chosen to write their answers. Voice stays
  // one click away either way.
  const canVoice = supported && !unavailable;
  const [preferType, setPreferType] = useState(!speakMode);
  const voiceMode = canVoice && !preferType;
  const hasText = value.trim().length > 0;

  const length = value.length;
  // Only worth showing as the cap gets close; a counter on every answer is noise.
  const showCount = length > MAX_ANSWER_LENGTH * 0.8;

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
    if ((disabled || !voiceMode) && listening) {
      // Locking the input means the answer is gone (sent, timed out, or the
      // interview ended) — drop the trailing flush. Switching to typing keeps
      // it, because those words are still the user's to edit.
      if (disabled) acceptTranscriptRef.current = false;
      stop();
    }
  }, [disabled, voiceMode, listening, stop]);

  // Keep the delivery capture in step with the microphone. Reported from an
  // effect rather than from the click handlers so the engine's own restarts
  // (it stops itself on a pause and `useSpeechRecognition` resumes it) don't
  // register as the candidate having stopped and started talking again.
  const recordingRef = useRef(false);
  useEffect(() => {
    const active = listening && !disabled;
    if (active === recordingRef.current) return;
    recordingRef.current = active;
    onRecordingChange?.(active);
  }, [listening, disabled, onRecordingChange]);

  // Report a final "stopped" on the way out, so an interview abandoned
  // mid-answer doesn't leave the capture believing it's still recording.
  useEffect(
    () => () => {
      if (recordingRef.current) onRecordingChange?.(false);
    },
    [onRecordingChange]
  );

  function startRecording() {
    baseRef.current = valueRef.current;
    acceptTranscriptRef.current = true;
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
    const trimmed = valueRef.current.trim();
    if (!trimmed || disabled) return;
    // Set before stopping: the flush this suppresses would otherwise re-fill the
    // composer with the answer we're sending right now.
    acceptTranscriptRef.current = false;
    if (listening) stop();
    onSend(trimmed);
  }

  // Move on to the next question now, whether or not anything's been answered.
  function skip() {
    if (disabled) return;
    acceptTranscriptRef.current = false;
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
    // Same reason as send(): otherwise the flush undoes the clear.
    acceptTranscriptRef.current = false;
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
          ref={textareaRef}
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
            {/* `maxLength` silently stops accepting keystrokes, which reads as a
                broken keyboard unless you can see the cap coming. */}
            {!disabled && showCount && (
              <span
                className={`${styles.count} ${
                  length >= MAX_ANSWER_LENGTH ? styles.countFull : ""
                }`}
                role="status"
              >
                {length >= MAX_ANSWER_LENGTH
                  ? "Answer limit reached"
                  : `${(MAX_ANSWER_LENGTH - length).toLocaleString()} left`}
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
                {voiceMode
                  ? speakMode
                    ? "Type this one instead"
                    : "Type instead"
                  : "Use voice"}
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
            {speakMode &&
              " Your pace, pauses and eye contact are measured entirely in this browser — that part is never sent anywhere."}
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
