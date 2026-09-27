import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import ResumeChatPanel from "../components/ResumeChatPanel.jsx";
import ResumePreview from "../components/ResumePreview.jsx";
import Icon from "../components/Icon.jsx";
import Toast from "../components/Toast.jsx";
import SegmentedControl from "../components/SegmentedControl.jsx";
import { chatResume } from "../api/resumeApi.js";
import { coerceResume, emptyResume, isResumeEmpty } from "../utils/resumeModel.js";
import {
  EXPORT_FORMATS,
  PAPER_SIZES,
  defaultPaper,
  exportResume,
} from "../utils/resumeExport.js";
import { nextId, RESUME_DRAFT_KEY, RESUME_MAX_HISTORY_MESSAGES } from "../constants.js";
import styles from "./ResumeBuilderScreen.module.css";

/**
 * Resume Builder — chat on the left, live resume on the right.
 *
 * THE SINGLE SOURCE OF TRUTH is `resume` in this component. The preview renders
 * from it, manual edits write to it, the chat request sends it, and every
 * exporter reads it. There is no second copy, and nothing derives a resume from
 * the chat transcript.
 *
 * Why that matters: the endpoint is stateless and receives the live document on
 * every turn, so if the user hand-edits a bullet and then asks for a change, the
 * model is looking at the edited bullet — it cannot answer from a stale copy it
 * remembered earlier in the conversation. `resumeRef` mirrors the state so the
 * async send handler reads the current document rather than a closed-over one.
 *
 * UNDO. Because the model returns the WHOLE document rather than a patch, one
 * bad turn can flatten hand-written bullets. Every write pushes the previous
 * document onto an undo stack (`undoRef`) tagged with what caused it, so the
 * toolbar can offer "Undo AI rewrite" specifically, and a hand edit can be taken
 * back too. The stack is capped — this is an undo affordance, not a document
 * history feature.
 *
 * AUTOSAVE. The document and the chat are mirrored to sessionStorage
 * (RESUME_DRAFT_KEY) on every change and read back on mount. Leaving the screen
 * used to destroy the draft, and a confirm on in-app navigation couldn't catch
 * the browser's Back button — a popstate never fires `beforeunload`. Now Back,
 * in-app navigation and a reload all come back to the same draft. It lives
 * until the tab closes (`beforeunload` still warns about that) or the user
 * signs out (the leave guard warns about that). The undo stack isn't saved.
 *
 * THE EDITING LOCK. While a turn is in flight, `busy` is true: every field in
 * the preview goes read-only, an overlay explains why, and Send becomes Stop.
 *
 * WHAT STOP DOES. The OpenRouter call isn't streamed, so there's no partial
 * output to halt. Stop therefore does two things: it aborts the HTTP request via
 * an AbortController (the browser stops waiting immediately), and it bumps
 * `runIdRef` so that if a response is already on the wire and lands anyway, the
 * resolver sees a stale run id and drops it without touching the resume. Either
 * way the UI unlocks at once and no late response can overwrite the user's work.
 * The server-side model call still finishes and still costs a call — that's the
 * unavoidable part without streaming.
 */

const SHEET_WIDTH = 816; // px — 8.5in at 96dpi, matches ResumePreview.module.css
const SHEET_PADDING = 20; // must match .sheetScroll padding in the stylesheet
const SCROLLBAR_RESERVE = 18; // width held back for the pane's vertical scrollbar
const UNDO_LIMIT = 30;
const TIP_KEY = "mockInterview:resumeTipSeen:v1";
// Letter or A4 for the PDF downloads — a per-viewer preference.
const PAPER_KEY = "mockInterview:resumePaper:v1";

function loadPaper() {
  try {
    const v = localStorage.getItem(PAPER_KEY);
    if (v && PAPER_SIZES[v]) return v;
  } catch {
    // storage blocked — fall back to the locale guess
  }
  return defaultPaper();
}
const STACK_QUERY = "(max-width: 900px)";
const FOCUSABLE =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

const GREETING =
  "Tell me about your most recent role, or paste in what you already have. " +
  "You can also edit the page on the right directly — I'll pick up your changes.";

const MESSAGE_ROLES = new Set(["user", "assistant", "note"]);

/** The tab's autosaved draft, or null. Never throws. */
function loadDraft() {
  try {
    const raw = sessionStorage.getItem(RESUME_DRAFT_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    const resume = coerceResume(parsed?.resume);
    if (!resume) return null;
    const messages = Array.isArray(parsed.messages)
      ? parsed.messages
          .filter((m) => m && MESSAGE_ROLES.has(m.role) && typeof m.text === "string")
          .map((m) => ({ id: typeof m.id === "string" ? m.id : nextId(), role: m.role, text: m.text }))
      : [];
    return { resume, messages };
  } catch {
    return null;
  }
}

function greeting() {
  return { id: nextId(), role: "assistant", text: GREETING };
}

const PANE_TABS = [
  { value: "chat", label: "Chat" },
  { value: "resume", label: "Resume" },
];

/** True while the viewport is narrow enough that the split layout stacks. */
function useStackedLayout() {
  const [stacked, setStacked] = useState(
    () => window.matchMedia?.(STACK_QUERY).matches ?? false
  );
  useEffect(() => {
    const mq = window.matchMedia?.(STACK_QUERY);
    if (!mq) return;
    const onChange = (e) => setStacked(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return stacked;
}

export default function ResumeBuilderScreen({ onBack, setLeaveGuard }) {
  // Read once, on mount: the draft this tab was working on, if any.
  const [draft] = useState(loadDraft);

  // --- the document (single source of truth) ---------------------------
  const [resume, setResumeState] = useState(() => draft?.resume ?? emptyResume());
  const resumeRef = useRef(resume);

  // Undo stack: [{ resume, label }], newest last. Refs rather than state for the
  // stack itself; `undoLabel` is the only part the render needs.
  const undoRef = useRef([]);
  const [undoLabel, setUndoLabel] = useState(null);

  /**
   * Every write to the document goes through here, AI or human.
   *
   * Accepts a value or an updater. The updater is applied against `resumeRef`
   * rather than React state, and the ref is written synchronously, so two
   * updates dispatched in the same tick compose correctly — e.g. pressing Enter
   * inside a bullet commits the text AND splits the bullet. Reading React state
   * there would give the second update a pre-commit document and silently drop
   * the typed text.
   *
   * `label` describes the change for the undo button ("your edit" by default,
   * "the AI rewrite" for a model turn).
   */
  const setResume = useCallback((next, label = "your edit") => {
    const previous = resumeRef.current;
    const value = typeof next === "function" ? next(previous) : next;
    if (value === previous) return;
    undoRef.current = [...undoRef.current, { resume: previous, label }].slice(
      -UNDO_LIMIT
    );
    setUndoLabel(label);
    resumeRef.current = value;
    setResumeState(value);
  }, []);

  const undo = useCallback(() => {
    const stack = undoRef.current;
    if (stack.length === 0) return;
    const last = stack[stack.length - 1];
    undoRef.current = stack.slice(0, -1);
    resumeRef.current = last.resume;
    setResumeState(last.resume);
    const nextTop = undoRef.current[undoRef.current.length - 1];
    setUndoLabel(nextTop ? nextTop.label : null);
  }, []);

  // --- chat -------------------------------------------------------------
  const [messages, setMessages] = useState(() =>
    draft?.messages?.length ? draft.messages : [greeting()]
  );
  const messagesRef = useRef(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  // A draft saved mid-turn (reload while the AI was writing) ends on the
  // user's message with no reply; say so, and Retry re-sends it.
  const [error, setError] = useState(() =>
    draft?.messages?.[draft.messages.length - 1]?.role === "user"
      ? "The reply to your last message didn't arrive. Try again."
      : ""
  );

  const runIdRef = useRef(0);
  const abortRef = useRef(null);

  // --- view state -------------------------------------------------------
  const stacked = useStackedLayout();
  const [pane, setPane] = useState("chat"); // only meaningful while stacked
  const [expanded, setExpanded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [downloading, setDownloading] = useState("");
  const [downloadError, setDownloadError] = useState("");
  // Set when a download had to differ from what was asked for (the text PDF
  // can't encode the resume's characters, so the exact-preview PDF was made).
  const [downloadNote, setDownloadNote] = useState("");
  const [paper, setPaper] = useState(loadPaper);

  function choosePaper(id) {
    setPaper(id);
    try {
      localStorage.setItem(PAPER_KEY, id);
    } catch {
      // not remembered — fine for this visit
    }
  }
  const [toast, setToast] = useState(null);
  const [tipDismissed, setTipDismissed] = useState(() => {
    try {
      return localStorage.getItem(TIP_KEY) === "1";
    } catch {
      return false;
    }
  });

  const sheetRef = useRef(null);
  const scrollRef = useRef(null);
  const menuRef = useRef(null);
  const downloadBtnRef = useRef(null);
  const dialogRef = useRef(null);

  function setBusyBoth(value) {
    busyRef.current = value;
    setBusy(value);
  }

  function dismissTip() {
    setTipDismissed(true);
    try {
      localStorage.setItem(TIP_KEY, "1");
    } catch {
      // ignore
    }
  }

  // Abandon any in-flight turn on unmount so a late response can't call
  // setState on a dead component.
  useEffect(
    () => () => {
      runIdRef.current += 1;
      abortRef.current?.abort();
    },
    []
  );

  const hasWork = !isResumeEmpty(resume);

  // Autosave. An empty page with only the greeting leaves nothing behind, so a
  // look-and-leave visit doesn't turn into a "draft".
  useEffect(() => {
    try {
      const pristine =
        !hasWork && messages.every((m) => m.role !== "user");
      if (pristine) sessionStorage.removeItem(RESUME_DRAFT_KEY);
      else sessionStorage.setItem(RESUME_DRAFT_KEY, JSON.stringify({ resume, messages }));
    } catch {
      // storage blocked or full — the draft just won't survive leaving
    }
  }, [resume, messages, hasWork]);

  /**
   * What autosave can't cover. Signing out clears the draft (it belongs to
   * whoever is signed in), so that asks first; ordinary in-app navigation
   * doesn't need to any more. Closing the tab drops sessionStorage, which
   * `beforeunload` warns about — it also fires on a reload, which is harmless
   * now that a reload restores the draft.
   */
  useEffect(() => {
    if (!setLeaveGuard) return undefined;
    if (!hasWork) {
      setLeaveGuard(null);
      return () => setLeaveGuard(null);
    }
    setLeaveGuard((intent) =>
      intent !== "sign-out" ||
      window.confirm(
        "Sign out?\n\nYour resume draft is only kept in this tab, and signing out clears it. Download it first if you want to keep it."
      )
    );
    return () => setLeaveGuard(null);
  }, [hasWork, setLeaveGuard]);

  useEffect(() => {
    if (!hasWork) return undefined;
    const onBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = ""; // required for Chrome to show its own prompt
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [hasWork]);

  /**
   * A fresh page. The draft now outlives the visit, so there has to be a way
   * to begin again; the document goes through `setResume`, so Undo brings it
   * back. The chat restarts too.
   */
  const startOver = useCallback(() => {
    if (busyRef.current) return;
    setResume(emptyResume(), "starting over");
    setMessages([greeting()]);
    setError("");
    setToast({ message: "Started a new resume. Undo brings the old one back.", tone: "success" });
  }, [setResume]);

  // --- send / stop ------------------------------------------------------

  /**
   * Runs one turn against `history`, which must already end with the user
   * message being answered. Kept separate from `send` so a retry re-sends the
   * existing transcript instead of appending the same message again.
   */
  const runTurn = useCallback(
    async (history) => {
      setMessages(history);
      setError("");
      setBusyBoth(true);

      const runId = ++runIdRef.current;
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const data = await chatResume({
          // Notes are local UI ("Stopped.") and never go to the model.
          messages: history
            .filter((m) => m.role === "user" || m.role === "assistant")
            .slice(-RESUME_MAX_HISTORY_MESSAGES)
            .map((m) => ({ role: m.role, content: m.text })),
          // The LIVE document, manual edits and all.
          resume: resumeRef.current,
          signal: controller.signal,
        });

        // Stopped, superseded, or unmounted — drop the response entirely.
        if (runIdRef.current !== runId) return;

        setMessages((prev) => [
          ...prev,
          { id: nextId(), role: "assistant", text: data.reply },
        ]);
        if (data.changed && data.resume) setResume(data.resume, "the AI rewrite");
        setBusyBoth(false);
      } catch (err) {
        if (runIdRef.current !== runId || err?.aborted) return;
        setError(err.message || "The assistant couldn't respond. Please try again.");
        setBusyBoth(false);
      }
    },
    [setResume]
  );

  const stop = useCallback(() => {
    if (!busyRef.current) return;
    runIdRef.current += 1; // any in-flight response is now stale
    abortRef.current?.abort();
    abortRef.current = null;
    setBusyBoth(false);
    setMessages((prev) => [
      ...prev,
      { id: nextId(), role: "note", text: "Stopped. Your resume is editable again." },
    ]);
  }, []);

  const send = useCallback(
    (text) => {
      if (busyRef.current || !text.trim()) return;
      const userMsg = { id: nextId(), role: "user", text: text.trim() };
      runTurn([...messagesRef.current, userMsg]);
    },
    [runTurn]
  );

  /** Re-send the transcript as it stands — no second copy of the message. */
  const retry = useCallback(() => {
    if (busyRef.current) return;
    const history = [...messagesRef.current];
    // A "Stopped." note could be sitting at the end; the history has to end on
    // the user's message for the server to accept it.
    while (history.length > 0 && history[history.length - 1].role === "note") {
      history.pop();
    }
    if (history[history.length - 1]?.role !== "user") return;
    runTurn(history);
  }, [runTurn]);

  // --- fullscreen: a real modal ----------------------------------------

  useEffect(() => {
    if (!expanded) return;
    const opener = document.activeElement;
    dialogRef.current?.focus();

    const onKey = (e) => {
      if (e.key === "Escape") {
        setExpanded(false);
        return;
      }
      if (e.key !== "Tab") return;
      // Trap: a modal that lets Tab wander into the page behind it isn't one.
      const nodes = Array.from(
        dialogRef.current?.querySelectorAll(FOCUSABLE) ?? []
      ).filter((n) => n.offsetParent !== null || n === document.activeElement);
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, [expanded]);

  // --- download menu ----------------------------------------------------

  useEffect(() => {
    if (!menuOpen) return;
    // Move focus into the menu so it's operable from the keyboard at all.
    const first = menuRef.current?.querySelector('[role="menuitem"]');
    first?.focus();

    const onDown = (e) => {
      if (
        !menuRef.current?.contains(e.target) &&
        !downloadBtnRef.current?.contains(e.target)
      ) {
        setMenuOpen(false);
      }
    };
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation(); // close the menu, not fullscreen
        setMenuOpen(false);
        downloadBtnRef.current?.focus();
        return;
      }
      if (!menuRef.current?.contains(e.target)) return;
      const items = Array.from(
        menuRef.current.querySelectorAll('[role="menuitem"], [role="menuitemradio"]')
      );
      const i = items.indexOf(document.activeElement);
      let next = null;
      if (e.key === "ArrowDown") next = (i + 1) % items.length;
      else if (e.key === "ArrowUp") next = (i - 1 + items.length) % items.length;
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = items.length - 1;
      if (next === null) return;
      e.preventDefault();
      items[next]?.focus();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [menuOpen]);

  async function handleDownload(format) {
    setMenuOpen(false);
    setDownloadError("");
    setDownloadNote("");
    setDownloading(format);
    try {
      const outcome = await exportResume(format, {
        resume: resumeRef.current,
        sheetEl: sheetRef.current,
        paper,
      });
      if (outcome?.fallback) {
        setDownloadNote(outcome.fallback);
      } else {
        const label = EXPORT_FORMATS.find((f) => f.id === format)?.label || "File";
        setToast({ message: `${label} downloaded`, tone: "success" });
      }
    } catch (err) {
      console.error("[resume] export failed:", err);
      setDownloadError(
        err?.message || "Could not build that file. Try a different format."
      );
    } finally {
      setDownloading("");
    }
  }

  // --- fit the fixed-width sheet into whatever space the pane has -------

  const [fit, setFit] = useState({ scale: 1, height: 1056 });
  const previewVisible = !stacked || pane === "resume" || expanded;

  useLayoutEffect(() => {
    const container = scrollRef.current;
    const sheet = sheetRef.current;
    if (!container || !sheet) return;

    const measure = () => {
      // Measure the BORDER box and reserve the scrollbar explicitly. Reading
      // `clientWidth` here is a trap: it shrinks when the vertical scrollbar
      // appears, which changes the scale, which changes the scaled height,
      // which toggles the scrollbar again — a ResizeObserver feedback loop that
      // locks up the renderer. The border-box width doesn't move with the
      // scrollbar, so the measurement is stable.
      const width = container.getBoundingClientRect().width;
      if (width === 0) return; // pane is hidden (stacked layout) — keep the last fit
      const available = width - SHEET_PADDING * 2 - SCROLLBAR_RESERVE;
      const scale = Math.min(1, Math.max(0.35, available / SHEET_WIDTH));
      const height = sheet.offsetHeight * scale;
      setFit((prev) =>
        Math.abs(prev.scale - scale) < 0.001 && Math.abs(prev.height - height) < 0.5
          ? prev // no-op update: don't re-render for sub-pixel noise
          : { scale, height }
      );
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(container);
    ro.observe(sheet);
    return () => ro.disconnect();
  }, [expanded, previewVisible]);

  const empty = !hasWork;
  const canUndo = undoRef.current.length > 0 && !busy;

  // --- the preview pane, shared by split and fullscreen layouts ---------

  const previewPane = (
    <section className={styles.previewPane} aria-label="Resume">
      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          <h2 className={styles.paneTitle}>Resume</h2>
          {busy ? (
            <span className={styles.lockBadge} role="status">
              <span className={styles.lockDot} aria-hidden="true" />
              AI is writing — editing locked
            </span>
          ) : (
            <span className={styles.editHint}>Click any line to edit</span>
          )}
        </div>

        <div className={styles.toolbarRight}>
          {/* The AI returns a whole document, so this is the safety net for a
              turn that rewrites something the user had written by hand. */}
          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={startOver}
            disabled={busy || (empty && messages.every((m) => m.role !== "user"))}
            title="Clear the page and the chat (Undo restores the page)"
          >
            <Icon name="refresh" />
            Start over
          </button>

          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={undo}
            disabled={!canUndo}
            title={undoLabel ? `Undo ${undoLabel}` : "Nothing to undo"}
          >
            <Icon name="undo" />
            Undo
          </button>

          <div className={styles.menuWrap}>
            <button
              type="button"
              ref={downloadBtnRef}
              className="btn-ghost btn-sm"
              onClick={() => setMenuOpen((o) => !o)}
              disabled={empty || !!downloading}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              <Icon name="download" />
              {downloading ? "Preparing…" : "Download"}
              <Icon name="chevronDown" />
            </button>

            {menuOpen && (
              <div className={styles.menu} ref={menuRef} role="menu">
                <div className={styles.paperRow} role="group" aria-label="Paper size">
                  <span className={styles.paperLabel} aria-hidden="true">
                    Paper size
                  </span>
                  {Object.values(PAPER_SIZES).map((size) => (
                    <button
                      key={size.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={paper === size.id}
                      className={styles.paperOption}
                      onClick={() => choosePaper(size.id)}
                    >
                      {size.label}
                    </button>
                  ))}
                </div>
                {EXPORT_FORMATS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    role="menuitem"
                    className={styles.menuItem}
                    onClick={() => handleDownload(f.id)}
                  >
                    <span className={styles.menuLabel}>{f.label}</span>
                    <span className={styles.menuHint}>{f.hint}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={() => setExpanded((v) => !v)}
          >
            <Icon name={expanded ? "collapse" : "expand"} />
            {expanded ? "Exit fullscreen" : "Expand"}
          </button>
        </div>
      </div>

      {downloadError && (
        <div className="error-banner" role="alert">
          <Icon name="alert" />
          <span>{downloadError}</span>
        </div>
      )}

      {downloadNote && (
        <div className="warn-banner" role="status">
          <Icon name="alert" />
          <span>{downloadNote}</span>
          <button
            type="button"
            className="link-btn"
            onClick={() => setDownloadNote("")}
          >
            Dismiss
          </button>
        </div>
      )}

      {empty && !busy && (
        <p className={styles.startHint}>
          <Icon name="sparkles" />
          <span>
            Click any line to type into it, or describe yourself in the chat.
          </span>
        </p>
      )}

      <div className={styles.sheetScroll} ref={scrollRef}>
        <div
          className={styles.sheetFit}
          style={{ height: fit.height, width: SHEET_WIDTH * fit.scale }}
        >
          <div
            className={styles.sheetScale}
            style={{ transform: `scale(${fit.scale})`, width: SHEET_WIDTH }}
          >
            <ResumePreview
              resume={resume}
              onChange={setResume}
              locked={busy}
              sheetRef={sheetRef}
            />
          </div>

          {/* The visible half of the editing lock: blocks pointer events over
              the whole sheet and says why. */}
          {busy && (
            <div className={styles.lockOverlay} aria-hidden="true">
              <span className={styles.lockPill}>
                <span className={styles.lockDot} />
                AI is writing…
              </span>
            </div>
          )}
        </div>
      </div>
    </section>
  );

  const chatPane = (
    <section className={styles.chatPane} aria-label="Resume assistant chat">
      <ResumeChatPanel
        messages={messages}
        busy={busy}
        error={error}
        onSend={send}
        onStop={stop}
        onRetry={retry}
      />
    </section>
  );

  if (expanded) {
    return (
      <div
        className={styles.fullscreen}
        role="dialog"
        aria-modal="true"
        aria-label="Resume fullscreen"
        ref={dialogRef}
        tabIndex={-1}
      >
        {previewPane}
        <Toast
          message={toast?.message}
          tone={toast?.tone}
          onDismiss={() => setToast(null)}
        />
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        {onBack && (
          <button type="button" className="btn-ghost btn-sm" onClick={onBack}>
            <Icon name="arrowLeft" />
            Back to home
          </button>
        )}

        {/* Below the split threshold there isn't room for both panes at once,
            so they become tabs rather than a long scroll of one then the other. */}
        {stacked && (
          <SegmentedControl
            options={PANE_TABS}
            value={pane}
            onChange={setPane}
            ariaLabel="Show chat or resume"
            size="sm"
          />
        )}

        {!tipDismissed && (
          <p className={styles.blurb}>
            <Icon name="sparkles" />
            <span>
              The chat and your own edits write to the same document. It's kept
              in this tab until you close it or sign out — download it to keep it.
            </span>
            <button
              type="button"
              className={styles.blurbClose}
              onClick={dismissTip}
              aria-label="Dismiss tip"
            >
              <Icon name="x" />
            </button>
          </p>
        )}
      </div>

      <div className={styles.split}>
        {(!stacked || pane === "chat") && chatPane}
        {(!stacked || pane === "resume") && previewPane}
      </div>

      <Toast
        message={toast?.message}
        tone={toast?.tone}
        onDismiss={() => setToast(null)}
      />
    </div>
  );
}
