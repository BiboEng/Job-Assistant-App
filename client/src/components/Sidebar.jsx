import { useCallback, useEffect, useState } from "react";
import Icon from "./Icon.jsx";
import AccountMenu from "./AccountMenu.jsx";
import styles from "./Sidebar.module.css";

/**
 * The signed-in app's left rail: wordmark, section nav, account.
 *
 * Collapsible, Linear-style — 240px with labels, or a 56px icon rail with
 * tooltips. The toggle button and the `[` key both flip it, and the choice is
 * remembered per browser. Below 768px it is always the rail: an expanded
 * sidebar would take two-thirds of a phone.
 *
 * `active` is the *section*, not the screen: setup/chat/results all belong to
 * "practice", a saved interview belongs to "home". During a live interview
 * (`interactive=false`) the nav is disabled rather than hidden — leaving would
 * abandon the session, but the user should still see where they are. The
 * account menu follows the same rule.
 *
 * Like the header it replaced, it stays free of auth and router imports: every
 * navigation goes back up through `onNavigate` / `onHome`, which AppWorkspace
 * funnels through its leave guard.
 */

const NAV = [
  { id: "home", label: "Home", icon: "home" },
  { id: "practice", label: "New Interview", icon: "messageSquare" },
  { id: "jobs", label: "Job Matches", icon: "briefcase" },
  { id: "resume", label: "Resume", icon: "fileText" },
];

const STORAGE_KEY = "jobassist:sidebarCollapsed:v1";
const NARROW_QUERY = "(max-width: 767px)";

function readCollapsed() {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function useNarrow() {
  const [narrow, setNarrow] = useState(
    () => typeof window !== "undefined" && Boolean(window.matchMedia?.(NARROW_QUERY).matches)
  );
  useEffect(() => {
    const mq = window.matchMedia?.(NARROW_QUERY);
    if (!mq) return undefined;
    const onChange = () => setNarrow(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return narrow;
}

/** True when a keypress belongs to whatever the user is typing into. */
function isTypingTarget(el) {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export default function Sidebar({
  onNavigate,
  onSignOut,
  onOpenSurvey,
  surveyState,
  user,
  active,
  interactive = true,
}) {
  const [userCollapsed, setUserCollapsed] = useState(readCollapsed);
  const narrow = useNarrow();
  const collapsed = narrow || userCollapsed;

  const toggle = useCallback(() => {
    setUserCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        // storage blocked — the choice just won't survive a reload
      }
      return next;
    });
  }, []);

  // `[` toggles, unless the keystroke is text going into a field (the chat
  // composer, the resume sheet's editable text, any input) or part of a chord.
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key !== "[" || e.defaultPrevented) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      e.preventDefault();
      toggle();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [toggle]);

  const disabledTip = "Finish or end the interview to navigate away";

  return (
    <aside
      className={`${styles.sidebar} ${collapsed ? styles.collapsed : ""} no-print`}
      aria-label="App"
    >
      <div className={styles.top}>
        {!collapsed && <span className={styles.wordmark}>Jobassist</span>}
        {!narrow && (
          <button
            type="button"
            className={styles.toggle}
            onClick={toggle}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            title={collapsed ? "Expand sidebar  [" : "Collapse sidebar  ["}
          >
            <Icon name={collapsed ? "panelOpen" : "panelClose"} />
          </button>
        )}
      </div>

      <nav className={styles.nav} aria-label="Sections">
        {NAV.map((item) => {
          const isActive = active === item.id;
          return (
            <button
              key={item.id}
              type="button"
              className={`${styles.item} ${isActive ? styles.active : ""}`}
              onClick={() => onNavigate?.(item.id)}
              disabled={!interactive}
              aria-current={isActive ? "page" : undefined}
              aria-label={collapsed ? item.label : undefined}
              title={interactive ? undefined : disabledTip}
            >
              <Icon name={item.icon} />
              {!collapsed && <span className={styles.label}>{item.label}</span>}
              {collapsed && interactive && (
                <span className={styles.tip} aria-hidden="true">
                  {item.label}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className={styles.bottom}>
        {onSignOut && (
          <AccountMenu
            user={user}
            collapsed={collapsed}
            onSignOut={onSignOut}
            onOpenSurvey={onOpenSurvey}
            surveyState={surveyState}
            interactive={interactive}
          />
        )}
      </div>
    </aside>
  );
}
