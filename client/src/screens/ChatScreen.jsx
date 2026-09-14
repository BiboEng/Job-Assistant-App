import { useEffect, useRef, useState } from "react";
import { submitAnswer, getFeedback } from "../api/interviewApi.js";
import ChatMessage from "../components/ChatMessage.jsx";
import ChatInput from "../components/ChatInput.jsx";
import Icon from "../components/Icon.jsx";
import { nextId } from "../constants.js";
import { formatDuration } from "../utils/time.js";
import styles from "./ChatScreen.module.css";

const countBy = (messages, role) => messages.filter((m) => m.role === role).length;

// Fallback for sessions restored from before time limits existed.
const DEFAULT_LIMIT_SECONDS = 180;

export default function ChatScreen({ session, messages, setMessages, onFinished, onRestart }) {
  const total = session.totalQuestions;

  const [busy, setBusy] = useState(false); // waiting on next question
  const [scoring, setScoring] = useState(false); // generating feedback
  const [error, setError] = useState("");
  const [feedbackError, setFeedbackError] = useState("");
  const [draft, setDraft] = useState("");
  const [secondsLeft, setSecondsLeft] = useState(null);
  const [announce, setAnnounce] = useState("");
  const [confirmEnd, setConfirmEnd] = useState(false);

  // Derive progress from the transcript so it survives a refresh.
  const answeredCount = countBy(messages, "candidate");
  const [interviewDone, setInterviewDone] = useState(
    () => countBy(messages, "candidate") >= total
  );

  const scrollRef = useRef(null);
  const feedbackStartedRef = useRef(false); // blocks duplicate /feedback calls
  const draftRef = useRef(draft);
  const autoSentForRef = useRef(null); // message id we already auto-submitted

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, busy, scoring]);

  const lastMsg = messages[messages.length - 1];
  const lastMsgId = lastMsg?.id ?? null;
  const awaitingAnswer =
    lastMsg?.role === "interviewer" && !busy && !scoring && !interviewDone;
  const currentLimit =
    lastMsg?.role === "interviewer"
      ? lastMsg.timeLimitSeconds || DEFAULT_LIMIT_SECONDS
      : null;

  // Pin an absolute deadline to the current question once, and persist it on the
  // message (App mirrors messages to sessionStorage). A page refresh then
  // resumes the same countdown from the time that's actually left, instead of
  // handing out a fresh full timer.
  useEffect(() => {
    if (!awaitingAnswer || !currentLimit || !lastMsgId) return;
    if (lastMsg?.deadlineAt) return;
    setMessages((m) =>
      m.map((msg) =>
        msg.id === lastMsgId && !msg.deadlineAt
          ? { ...msg, deadlineAt: Date.now() + currentLimit * 1000 }
          : msg
      )
    );
  }, [lastMsgId, awaitingAnswer, currentLimit, lastMsg?.deadlineAt, setMessages]);

  const deadlineAt = awaitingAnswer ? lastMsg?.deadlineAt ?? null : null;

  // Countdown for the current question. Driven off the stored absolute deadline
  // and the wall clock so a backgrounded (throttled) tab — or a full refresh —
  // doesn't let it drift; on refocus it snaps to the right value.
  useEffect(() => {
    if (!awaitingAnswer || !currentLimit || !deadlineAt) {
      setSecondsLeft(null);
      return;
    }
    setAnnounce("");

    const tick = () => {
      const remaining = Math.max(0, Math.round((deadlineAt - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (remaining === 0) clearInterval(iv);
    };
    tick();
    const iv = setInterval(tick, 500);
    return () => clearInterval(iv);
  }, [deadlineAt, awaitingAnswer, currentLimit]);

  // Screen-reader nudges without announcing every tick.
  useEffect(() => {
    if (secondsLeft === 60) setAnnounce("One minute left for this answer.");
    else if (secondsLeft === 20) setAnnounce("Twenty seconds left for this answer.");
  }, [secondsLeft]);

  // Auto-submit whatever's typed when the clock runs out.
  useEffect(() => {
    if (
      secondsLeft === 0 &&
      awaitingAnswer &&
      autoSentForRef.current !== lastMsgId
    ) {
      autoSentForRef.current = lastMsgId;
      handleSend(draftRef.current, { timedOut: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondsLeft, awaitingAnswer, lastMsgId]);

  async function handleSend(answer, { timedOut = false, skipped = false } = {}) {
    if (busy || scoring || interviewDone) return;

    const text = (answer || "").trim();
    if (!text && !timedOut && !skipped) return;

    const optimisticId = nextId();
    setMessages((m) => [
      ...m,
      text
        ? { id: optimisticId, role: "candidate", text }
        : {
            id: optimisticId,
            role: "system",
            text: skipped
              ? "Skipped — moving on to the next question."
              : "Time's up — moving on with no answer for this question.",
          },
    ]);
    setDraft("");
    setBusy(true);
    setError("");

    try {
      const data = await submitAnswer(session.sessionId, text, {
        timedOut: timedOut || skipped,
      });

      if (data.done) {
        setInterviewDone(true);
        setMessages((m) => [
          ...m,
          {
            id: nextId(),
            role: "system",
            text: "That's all the questions. Generating your feedback…",
          },
        ]);
      } else {
        setMessages((m) => [
          ...m,
          {
            id: nextId(),
            role: "interviewer",
            text: data.question,
            timeLimitSeconds: data.timeLimitSeconds,
          },
        ]);
      }
    } catch (err) {
      setError(err.message);
      // roll back exactly the optimistic message we added; restore the draft on
      // a manual send so the answer isn't lost (a timed-out send had nothing
      // worth keeping).
      setMessages((m) => m.filter((msg) => msg.id !== optimisticId));
      if (!timedOut) setDraft(answer);
      else autoSentForRef.current = null; // let the restarted timer retry
    } finally {
      setBusy(false);
    }
  }

  // Auto-generate feedback once the interview completes (naturally or restored
  // in that state after a refresh).
  useEffect(() => {
    if (interviewDone) runFeedback();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interviewDone]);

  // "Next question" / "Skip": move on now, keeping whatever's in the draft
  // (empty draft just skips the question).
  function handleSkip() {
    handleSend(draftRef.current, { skipped: true });
  }

  // "End interview": score the answers so far, or — if nothing's been answered
  // yet — just abandon back to the start. Confirmed first: it's one click away
  // from throwing away a part-finished interview.
  function handleEndInterview() {
    if (busy || scoring || interviewDone) return;
    setConfirmEnd(false);
    if (answeredCount > 0) runFeedback();
    else onRestart();
  }

  async function runFeedback() {
    if (feedbackStartedRef.current) return; // StrictMode double-invoke / double click
    feedbackStartedRef.current = true;

    setScoring(true);
    setError("");
    setFeedbackError("");
    try {
      const fb = await getFeedback(session.sessionId);
      onFinished(fb);
    } catch (err) {
      setFeedbackError(err.message);
      setScoring(false);
      feedbackStartedRef.current = false; // allow a manual retry
    }
  }

  const questionsAsked = countBy(messages, "interviewer");
  const currentQuestion = interviewDone
    ? total
    : Math.min(Math.max(questionsAsked, 1), total);
  const canEndNow = !interviewDone && !busy && !scoring;
  const sessionLost = /not found or expired/i.test(error);

  const urgency =
    secondsLeft == null
      ? ""
      : secondsLeft <= 20
      ? styles.urgent
      : secondsLeft <= 60
      ? styles.warn
      : "";
  const timeFraction =
    secondsLeft != null && currentLimit
      ? Math.max(0, Math.min(1, secondsLeft / currentLimit))
      : 1;

  return (
    <div className={styles.wrap}>
      {/* Progress reads as progress: a segment per question, filled as you go. */}
      <div className={styles.statusBar}>
        <div className={styles.progress}>
          <span className={styles.progressLabel}>
            Question <strong>{currentQuestion}</strong> of {total}
          </span>
          <span
            className={styles.segments}
            role="img"
            aria-label={`Question ${currentQuestion} of ${total}, ${answeredCount} answered`}
          >
            {Array.from({ length: total }, (_, i) => (
              <span
                key={i}
                className={`${styles.segment} ${
                  i < answeredCount
                    ? styles.segmentDone
                    : i === answeredCount && !interviewDone
                    ? styles.segmentCurrent
                    : ""
                }`}
              />
            ))}
          </span>
        </div>

        {confirmEnd ? (
          <div className={styles.confirmEnd} role="group" aria-label="Confirm ending">
            <span className={styles.confirmText}>
              {answeredCount > 0
                ? `Score the ${answeredCount} answer${answeredCount === 1 ? "" : "s"} so far?`
                : "Nothing answered yet — discard this interview?"}
            </span>
            <button className="btn-danger btn-sm" onClick={handleEndInterview}>
              {answeredCount > 0 ? "End & score" : "Discard"}
            </button>
            <button className="btn-ghost btn-sm" onClick={() => setConfirmEnd(false)}>
              Keep going
            </button>
          </div>
        ) : (
          <button
            className="btn-ghost btn-sm"
            onClick={() => setConfirmEnd(true)}
            disabled={!canEndNow}
          >
            End interview
          </button>
        )}
      </div>

      {error && (
        <div className="error-banner" role="alert">
          <Icon name="alert" size={16} />
          <span>{error}</span>
          {sessionLost && (
            <button className="btn-ghost" onClick={onRestart}>
              Start over
            </button>
          )}
        </div>
      )}

      {feedbackError && (
        <div className="error-banner" role="alert">
          <Icon name="alert" size={16} />
          <span>Couldn't generate feedback: {feedbackError}</span>
          <button className="btn-ghost" onClick={runFeedback} disabled={scoring}>
            Try again
          </button>
          <button className="btn-ghost" onClick={onRestart}>
            Start over
          </button>
        </div>
      )}

      <div
        className={styles.thread}
        ref={scrollRef}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
      >
        {messages.map((m) => (
          <ChatMessage key={m.id} role={m.role} text={m.text} />
        ))}
        {busy && <ChatMessage role="interviewer" typing />}
        {scoring && <ChatMessage role="system" text="Scoring your interview…" />}
      </div>

      <p className="sr-only" role="status">
        {announce}
      </p>

      {awaitingAnswer && secondsLeft != null && (
        <div className={`${styles.timer} ${urgency}`} role="timer">
          <div className={styles.timerHead}>
            <Icon name="clock" size={15} />
            <span className={styles.timerValue}>{formatDuration(secondsLeft)}</span>
            <span className={styles.timerNote}>left for this answer</span>
          </div>
          {/* A depleting track: the number says how long, the bar says how far. */}
          <div className={styles.timerTrack} aria-hidden="true">
            <div
              className={styles.timerFill}
              style={{ transform: `scaleX(${timeFraction})` }}
            />
          </div>
        </div>
      )}

      <ChatInput
        value={draft}
        onChange={setDraft}
        onSend={handleSend}
        onSkip={handleSkip}
        disabled={busy || scoring || interviewDone}
        placeholder={interviewDone ? "Interview complete" : "Type your answer…"}
      />
    </div>
  );
}
