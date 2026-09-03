import { useEffect, useRef, useState } from "react";
import AppHeader from "./components/AppHeader.jsx";
import HomeScreen from "./screens/HomeScreen.jsx";
import JobDescriptionScreen from "./screens/JobDescriptionScreen.jsx";
import ChatScreen from "./screens/ChatScreen.jsx";
import ResultsScreen from "./screens/ResultsScreen.jsx";
import HistoryDetailScreen from "./screens/HistoryDetailScreen.jsx";
import { saveInterview } from "./api/historyApi.js";
import { STORAGE_KEY, nextId } from "./constants.js";

/**
 * Screens: 'home' -> 'setup' -> 'chat' -> 'results', plus 'historyDetail'.
 * App owns the active session + transcript. An in-progress interview ('chat' /
 * 'results') is mirrored to sessionStorage so a refresh resumes it; other
 * screens always start from 'home'.
 */

const RESUMABLE = new Set(["chat", "results"]);

function loadPersisted() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

const persisted = loadPersisted();

export default function App() {
  const [screen, setScreen] = useState(
    persisted && RESUMABLE.has(persisted.screen) ? persisted.screen : "home"
  );
  const [session, setSession] = useState(persisted?.session ?? null); // { sessionId, totalQuestions }
  const [messages, setMessages] = useState(persisted?.messages ?? []); // [{ id, role, text }]
  const [feedback, setFeedback] = useState(persisted?.feedback ?? null);
  const [detailId, setDetailId] = useState(null);
  const [saveState, setSaveState] = useState("idle"); // idle | saving | saved | error

  // The session id we're persisting — captured so a retry still works after the
  // active session is cleared on navigation.
  const savingIdRef = useRef(null);

  useEffect(() => {
    try {
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ screen, session, messages, feedback })
      );
    } catch {
      // storage unavailable — refresh recovery just won't work
    }
  }, [screen, session, messages, feedback]);

  function clearActive() {
    setSession(null);
    setMessages([]);
    setFeedback(null);
  }

  function goHome() {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    clearActive();
    setDetailId(null);
    setSaveState("idle");
    setScreen("home");
  }

  function startNew() {
    clearActive();
    setSaveState("idle");
    setScreen("setup");
  }

  function handleStarted({ sessionId, question, totalQuestions, timeLimitSeconds }) {
    setSession({ sessionId, totalQuestions });
    setMessages([
      { id: nextId(), role: "interviewer", text: question, timeLimitSeconds },
    ]);
    setFeedback(null);
    setSaveState("idle");
    setScreen("chat");
  }

  function persistInterview(sessionId) {
    if (!sessionId) return;
    savingIdRef.current = sessionId;
    setSaveState("saving");
    saveInterview(sessionId)
      .then(() => setSaveState("saved"))
      .catch((err) => {
        console.warn("Could not save interview to history:", err.message);
        setSaveState("error");
      });
  }

  function handleFinished(fb) {
    setFeedback(fb);
    setScreen("results");
    persistInterview(session?.sessionId);
  }

  function retrySave() {
    persistInterview(savingIdRef.current);
  }

  function openInterview(id) {
    setDetailId(id);
    setScreen("historyDetail");
  }

  const chatReady = screen === "chat" && session?.sessionId;

  return (
    <div className="app-shell">
      <AppHeader onHome={goHome} interactive={screen !== "chat"} />

      {screen === "home" && (
        <HomeScreen onStartNew={startNew} onOpenInterview={openInterview} />
      )}

      {screen === "setup" && (
        <JobDescriptionScreen onStarted={handleStarted} onBack={goHome} />
      )}

      {chatReady && (
        <ChatScreen
          session={session}
          messages={messages}
          setMessages={setMessages}
          onFinished={handleFinished}
          onRestart={goHome}
        />
      )}

      {screen === "chat" && !chatReady && (
        <div className="error-banner" role="alert">
          Your session could not be restored.{" "}
          <button className="btn-ghost" onClick={goHome}>
            Start over
          </button>
        </div>
      )}

      {screen === "results" && (
        <ResultsScreen
          feedback={feedback}
          saveState={saveState}
          onRetrySave={retrySave}
          onRestart={startNew}
          onHome={goHome}
        />
      )}

      {screen === "historyDetail" && (
        <HistoryDetailScreen interviewId={detailId} onBack={goHome} />
      )}
    </div>
  );
}
