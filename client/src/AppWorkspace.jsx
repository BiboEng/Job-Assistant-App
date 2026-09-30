import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import {
  Outlet,
  useLocation,
  useNavigate,
  useOutletContext,
  useParams,
  useSearchParams,
} from "react-router";
import Sidebar from "./components/Sidebar.jsx";
import HomeScreen from "./screens/HomeScreen.jsx";
import JobDescriptionScreen from "./screens/JobDescriptionScreen.jsx";
import ChatScreen from "./screens/ChatScreen.jsx";
import ResultsScreen from "./screens/ResultsScreen.jsx";
import HistoryDetailScreen from "./screens/HistoryDetailScreen.jsx";
import JobMatchesScreen from "./screens/JobMatchesScreen.jsx";
import ResumeBuilderScreen from "./screens/ResumeBuilderScreen.jsx";
import SurveyScreen from "./screens/SurveyScreen.jsx";
import ProgressScreen from "./screens/ProgressScreen.jsx";
import TrackerScreen from "./screens/TrackerScreen.jsx";
import { useAuth } from "./auth/AuthProvider.jsx";
import { useSurvey } from "./survey/useSurvey.js";
import Toast from "./components/Toast.jsx";
import { getInterview, saveInterview } from "./api/historyApi.js";
import { startInterview } from "./api/interviewApi.js";
import { STORAGE_KEY, nextId } from "./constants.js";
import { repeatSettings, roleHeadline } from "./utils/repeatInterview.js";
import { PATHS } from "./routes.js";

/**
 * The signed-in app: a layout route (behind RequireAuth) that owns everything
 * App.jsx used to own when navigation was a `screen` string — the active
 * interview session + transcript, the save state, and the cached Job Matches
 * result. Because it's a *layout* route it stays mounted while the child routes
 * change underneath it, so that state survives navigation exactly as it did
 * before the router.
 *
 * Child routes are the thin `*Route` components at the bottom of this file:
 * each reads the workspace through `useWorkspace()` and hands the screen the
 * same callbacks it always had. The screens themselves know nothing about URLs.
 *
 * Paths:
 *   /dashboard              HomeScreen (history + the three features)
 *   /interview/new          JobDescriptionScreen (setup)
 *   /interview              ChatScreen (the live interview)
 *   /interview/results      ResultsScreen
 *   /history/:interviewId   HistoryDetailScreen
 *   /jobs                   JobMatchesScreen
 *   /resume                 ResumeBuilderScreen
 *   /progress               ProgressScreen (?role=<key> selects a role)
 *   /applications           TrackerScreen (the Application Tracker board)
 *
 * An in-progress interview (/interview, /interview/results) is mirrored to
 * sessionStorage, so a refresh on those paths resumes it; every other path
 * starts with no active interview, as before.
 *
 * This whole module is lazy-loaded by App.jsx, so a visitor to the public
 * landing page never downloads the app. Each `*Route` export is its own
 * React.lazy wrapper over this same chunk, and the first render of each one
 * suspends for a tick — hence the Suspense *inside* the layout, around the
 * Outlet. Without it the suspension would reach the boundary above the layout,
 * unmount it, and throw away the interview state this component exists to hold.
 */

const RESUMABLE = new Set([PATHS.chat, PATHS.results]);

// `repeating` value for "Practice again" on the interview just finished.
const CURRENT = "current";

// Paths that need more than the standard reading-width column. The Resume
// Builder is a side-by-side workspace, not a document.
const WIDE_PATHS = new Set([PATHS.resume]);

// Paths that need the wide width but scroll as a normal page. The tracker's
// four columns want room, but its columns grow with their cards — bounding it
// to the viewport like the Resume Builder would give every column a scrollbar.
const BOARD_PATHS = new Set([PATHS.applications]);

function shellClass(pathname) {
  if (WIDE_PATHS.has(pathname)) return "app-shell--wide";
  if (BOARD_PATHS.has(pathname)) return "app-shell--board";
  return "";
}

// Which sidebar item is lit for a path. The nav addresses sections, not
// screens: everything in the live interview flow belongs to "practice", and a
// saved interview is opened from — so belongs to — Home, unless it was opened
// from Progress (`from` in router state), in which case it belongs there.
function sectionOf(pathname, from) {
  if (pathname.startsWith("/history/")) {
    return typeof from === "string" && from.startsWith(PATHS.progress) ? "progress" : "home";
  }
  if (pathname === PATHS.dashboard) return "home";
  if (pathname.startsWith("/interview")) return "practice";
  if (pathname === PATHS.jobs) return "jobs";
  if (pathname === PATHS.resume) return "resume";
  if (pathname === PATHS.progress) return "progress";
  if (pathname === PATHS.applications) return "applications";
  return undefined;
}

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

export default function AppWorkspace() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const pathname = location.pathname;

  // Whether this account has taken the career survey. Owned here so the
  // dashboard banner and the header's account menu read one fetch rather than
  // one each. It's pure data collection — nothing downstream of it touches a
  // model call.
  const survey = useSurvey();

  // Read once, at mount, and only when landing on a resumable path.
  const [persisted] = useState(() =>
    RESUMABLE.has(location.pathname) ? loadPersisted() : null
  );

  // { sessionId, totalQuestions, mode }
  const [session, setSession] = useState(persisted?.session ?? null);
  const [messages, setMessages] = useState(persisted?.messages ?? []); // [{ id, role, text }]
  const [feedback, setFeedback] = useState(persisted?.feedback ?? null);
  const [saveState, setSaveState] = useState("idle"); // idle | saving | saved | error
  // The history id the finished interview was saved under, so "Practice
  // again" on the results page still works for a session restored without
  // its setup.
  const [savedId, setSavedId] = useState(null);

  // "Practice again" in flight: which source is starting (an interview id, or
  // CURRENT for the interview just finished). One at a time.
  const [repeating, setRepeating] = useState(null);
  const [repeatError, setRepeatError] = useState("");
  const repeatingRef = useRef(false);
  // Stable, because Toast re-arms its dismiss timer whenever this changes.
  const dismissRepeatError = useCallback(() => setRepeatError(""), []);

  // Last Job Matches result, kept at the workspace level so leaving the screen
  // and coming back doesn't throw away results (and re-spend model calls).
  const [jobsResult, setJobsResult] = useState(null);

  /**
   * A screen with unsaved work can register a check here; it is called with
   * the reason — "navigate" or "sign-out" — and returns false to cancel.
   * React Router's declarative mode has no `useBlocker`, so this is the one
   * place every nav button in the signed-in app funnels through. It does NOT
   * cover the browser Back button — nothing in declarative mode can, and a
   * popstate doesn't fire `beforeunload` either — which is why the Resume
   * Builder autosaves its draft rather than relying on a guard.
   */
  const leaveGuardRef = useRef(null);
  const setLeaveGuard = useCallback((fn) => {
    leaveGuardRef.current = fn;
  }, []);

  function guarded(run) {
    if (leaveGuardRef.current && leaveGuardRef.current("navigate") === false) return;
    leaveGuardRef.current = null; // the screen holding it is on its way out
    run();
  }

  // The session id we're persisting — captured so a retry still works after the
  // active session is cleared on navigation.
  const savingIdRef = useRef(null);
  const restoreSaveRef = useRef(false);
  // Set while signing out, so the mirror effect can't write the interview back
  // into sessionStorage after AuthProvider has cleared it.
  const signingOutRef = useRef(false);

  useEffect(() => {
    if (signingOutRef.current) return;
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ session, messages, feedback }));
    } catch {
      // storage unavailable — refresh recovery just won't work
    }
  }, [session, messages, feedback]);

  // If we reload straight onto the results page (persisted in sessionStorage),
  // the interview was already completed but may never have been saved — the
  // original save could have failed on a network blip with no way back to it.
  // Re-run the idempotent save once so history stays consistent.
  useEffect(() => {
    if (restoreSaveRef.current) return;
    restoreSaveRef.current = true;
    if (pathname === PATHS.results && feedback && session?.sessionId) {
      persistInterview(session.sessionId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function clearActive() {
    setSession(null);
    setMessages([]);
    setFeedback(null);
  }

  function goHome() {
    guarded(() => {
      try {
        sessionStorage.removeItem(STORAGE_KEY);
      } catch {
        // ignore
      }
      clearActive();
      setSaveState("idle");
      navigate(PATHS.dashboard);
    });
  }

  function startNew() {
    guarded(() => {
      clearActive();
      setSaveState("idle");
      navigate(PATHS.setup);
    });
  }

  function handleStarted(
    { sessionId, question, totalQuestions, mode, timeLimitSeconds, role, focus, setup },
    { replace = true } = {}
  ) {
    // `mode` comes from the server's response rather than what we asked for, and
    // rides on `session` so it survives the sessionStorage round-trip: a refresh
    // mid-interview has to come back into the same mode it left. `role` and
    // `focus` ride along for the same reason — the results screen needs to say
    // which interview it is reporting on. `setup` is what it was started with
    // (job description, count, focus, mode), so the results screen can offer
    // "Practice again" without a round trip.
    setSession({
      sessionId,
      totalQuestions,
      mode: mode || "type",
      role: role || "",
      focus: focus || "",
      startedAt: Date.now(),
      setup: setup || null,
    });
    setMessages([
      { id: nextId(), role: "interviewer", text: question, timeLimitSeconds },
    ]);
    setFeedback(null);
    setSaveState("idle");
    setSavedId(null);
    // Replace by default, so Back from the live interview returns to the
    // dashboard rather than to a setup form for an interview that has already
    // started. "Practice again" pushes instead (unless it came from a results
    // page), so Back returns to the Progress or history page it started from.
    navigate(PATHS.chat, { replace });
  }

  /**
   * "Practice again": start a fresh interview in the same format as an earlier
   * one — same job description, question count, focus and answer mode, new
   * questions — without going through the setup form.
   *
   * `interviewId` is a saved interview (its record is fetched for the job
   * description); null means the interview just finished, whose setup is
   * already on the session. A speak-mode repeat asks for the camera on the
   * interview screen, which falls back to typing if it's refused, exactly as
   * a speak-mode interview whose permission lapses does.
   */
  async function practiceAgain(interviewId = null) {
    if (repeatingRef.current) return;
    repeatingRef.current = true;
    setRepeating(interviewId ?? CURRENT);
    setRepeatError("");
    const fromResults = pathname === PATHS.results;
    try {
      let source = null;
      if (interviewId) source = await getInterview(interviewId);
      else if (session?.setup) source = session.setup;
      else if (savedId) source = await getInterview(savedId);

      const settings = repeatSettings(source);
      if (!settings) {
        throw new Error(
          "This interview can't be repeated: its job description is missing or no longer valid. Start a new interview instead."
        );
      }

      const data = await startInterview(settings.jobDescription, {
        questionCount: settings.questionCount,
        focus: settings.focus,
        mode: settings.mode,
      });
      guarded(() =>
        handleStarted(
          {
            ...data,
            role: roleHeadline(settings.jobDescription),
            focus: settings.focus,
            setup: settings,
          },
          { replace: fromResults }
        )
      );
    } catch (err) {
      setRepeatError(`Couldn't start the interview: ${err.message}`);
    } finally {
      repeatingRef.current = false;
      setRepeating(null);
    }
  }

  function persistInterview(sessionId) {
    if (!sessionId) return;
    savingIdRef.current = sessionId;
    setSaveState("saving");
    saveInterview(sessionId)
      .then((record) => {
        if (record?.id) setSavedId(record.id);
        setSaveState("saved");
      })
      .catch((err) => {
        console.warn("Could not save interview to history:", err.message);
        setSaveState("error");
      });
  }

  function handleFinished(fb) {
    setFeedback(fb);
    // Replace, so Back from the report can't land on a finished chat.
    navigate(PATHS.results, { replace: true });
    persistInterview(session?.sessionId);
  }

  function retrySave() {
    persistInterview(savingIdRef.current);
  }

  // `from` rides in router state so the review's Back button can return to
  // where it was opened (Progress, with its selected role) instead of Home.
  function openInterview(id) {
    const from = pathname === PATHS.progress ? pathname + location.search : null;
    guarded(() => navigate(PATHS.history(id), from ? { state: { from } } : undefined));
  }

  function openProgress() {
    guarded(() => navigate(PATHS.progress));
  }

  function openJobMatches() {
    guarded(() => navigate(PATHS.jobs));
  }

  function openResumeBuilder() {
    guarded(() => navigate(PATHS.resume));
  }

  function openTracker() {
    guarded(() => navigate(PATHS.applications));
  }

  function openSurvey() {
    guarded(() => navigate(PATHS.survey));
  }

  /**
   * Sidebar nav. Disabled during a live interview, so the interview needs no
   * guard here; the Resume Builder registers one because its document is
   * session-only and leaving throws it away.
   */
  function navigateSection(section) {
    if (section === "home") {
      if (pathname !== PATHS.dashboard) goHome();
    } else if (section === "practice") {
      if (pathname !== PATHS.setup) startNew();
    } else if (section === "progress") {
      if (pathname !== PATHS.progress) openProgress();
    } else if (section === "jobs") {
      if (pathname !== PATHS.jobs) openJobMatches();
    } else if (section === "applications") {
      if (pathname !== PATHS.applications) openTracker();
    } else if (section === "resume") {
      // Guard the no-op too: without this, clicking "Resume" while already in
      // the Resume Builder asks whether you want to abandon the document you
      // are not actually leaving.
      if (pathname !== PATHS.resume) openResumeBuilder();
    }
  }

  async function handleSignOut() {
    if (leaveGuardRef.current && leaveGuardRef.current("sign-out") === false) return;
    leaveGuardRef.current = null;
    signingOutRef.current = true;
    // Leave first: once the session is gone RequireAuth would redirect to
    // /sign-in, and signing out should land on the public front page instead.
    navigate(PATHS.home, { replace: true });
    await signOut();
  }

  const workspace = {
    session,
    messages,
    setMessages,
    feedback,
    saveState,
    jobsResult,
    setJobsResult,
    goHome,
    startNew,
    handleStarted,
    handleFinished,
    retrySave,
    openInterview,
    openJobMatches,
    openResumeBuilder,
    openProgress,
    openTracker,
    openSurvey,
    survey,
    setLeaveGuard,
    practiceAgain,
    repeating,
  };

  return (
    <div className="app-frame">
      <Sidebar
        onNavigate={navigateSection}
        onSignOut={handleSignOut}
        onOpenSurvey={openSurvey}
        surveyState={survey.state}
        user={user}
        active={sectionOf(pathname, location.state?.from)}
        interactive={pathname !== PATHS.chat}
      />

      <main
        id="main-content"
        className={`app-main app-shell ${shellClass(pathname)}`}
      >
        {/* Keyed so each screen mounts fresh on navigation. */}
        <div key={pathname} className="screen-slot screen-enter">
          <Suspense fallback={null}>
            <Outlet context={workspace} />
          </Suspense>
        </div>
      </main>

      {/* "Practice again" can be pressed from four screens; its failure is
          reported here, once, rather than by each of them. */}
      <Toast
        message={repeatError}
        tone="error"
        duration={6000}
        onDismiss={dismissRepeatError}
      />
    </div>
  );
}

function useWorkspace() {
  return useOutletContext();
}

/* --- child routes ------------------------------------------------------------ */

export function DashboardRoute() {
  const w = useWorkspace();
  return (
    <HomeScreen
      onStartNew={w.startNew}
      onOpenInterview={w.openInterview}
      onPracticeAgain={w.practiceAgain}
      repeating={w.repeating}
      onFindJobs={w.openJobMatches}
      onBuildResume={w.openResumeBuilder}
      showSurveyPrompt={w.survey.shouldPrompt}
      onTakeSurvey={w.openSurvey}
      onSkipSurvey={w.survey.skip}
    />
  );
}

export function SetupRoute() {
  const w = useWorkspace();
  return <JobDescriptionScreen onStarted={w.handleStarted} onBack={w.goHome} />;
}

export function ChatRoute() {
  const w = useWorkspace();
  if (!w.session?.sessionId) {
    return (
      <div className="error-banner" role="alert">
        Your session could not be restored.{" "}
        <button className="btn-ghost" onClick={w.goHome}>
          Start over
        </button>
      </div>
    );
  }
  return (
    <ChatScreen
      session={w.session}
      messages={w.messages}
      setMessages={w.setMessages}
      onFinished={w.handleFinished}
      onRestart={w.goHome}
    />
  );
}

export function ResultsRoute() {
  const w = useWorkspace();
  return (
    <ResultsScreen
      feedback={w.feedback}
      session={w.session}
      saveState={w.saveState}
      onRetrySave={w.retrySave}
      onPracticeAgain={() => w.practiceAgain(null)}
      repeating={w.repeating}
      onRestart={w.startNew}
      onHome={w.goHome}
    />
  );
}

export function HistoryDetailRoute() {
  const w = useWorkspace();
  const { interviewId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  // Only ever a same-app path we put there ourselves (see openInterview).
  const from = location.state?.from;
  const backToProgress = typeof from === "string" && from.startsWith(PATHS.progress);
  return (
    <HistoryDetailScreen
      interviewId={interviewId}
      onPracticeAgain={() => w.practiceAgain(interviewId)}
      repeating={w.repeating}
      onBack={backToProgress ? () => navigate(from) : w.goHome}
      backLabel={backToProgress ? "Back to progress" : "Back to home"}
    />
  );
}

export function JobMatchesRoute() {
  const w = useWorkspace();
  return (
    <JobMatchesScreen
      onBack={w.goHome}
      cachedResult={w.jobsResult}
      onResult={w.setJobsResult}
      onOpenTracker={w.openTracker}
    />
  );
}

export function ResumeBuilderRoute() {
  const w = useWorkspace();
  return <ResumeBuilderScreen onBack={w.goHome} setLeaveGuard={w.setLeaveGuard} />;
}

export function SurveyRoute() {
  const w = useWorkspace();
  return (
    <SurveyScreen
      // A save of either kind updates the cached status, so the banner is gone
      // the moment we're back on the dashboard rather than after a reload.
      onDone={(status) => {
        w.survey.markSaved(status);
        w.goHome();
      }}
      onExit={w.goHome}
    />
  );
}

export function ProgressRoute() {
  const w = useWorkspace();
  const [params, setParams] = useSearchParams();
  return (
    <ProgressScreen
      onStartNew={w.startNew}
      onOpenInterview={w.openInterview}
      onPracticeAgain={w.practiceAgain}
      repeating={w.repeating}
      selectedRole={params.get("role")}
      // Replace, not push: flipping between roles shouldn't fill the Back stack.
      onSelectRole={(key) => setParams({ role: key }, { replace: true })}
    />
  );
}

export function TrackerRoute() {
  const w = useWorkspace();
  return <TrackerScreen onFindJobs={w.openJobMatches} />;
}
