import { useCallback, useEffect, useId, useRef, useState } from "react";
import Icon from "./Icon.jsx";
import AccountMenu from "./AccountMenu.jsx";
import styles from "./Sidebar.module.css";

/**
 * The signed-in app's left rail: wordmark, section nav, account.
 *
 * Collapsible, Linear-style — 240px with labels, or a 56px icon rail with
 * tooltips. The toggle button and the `[` key both flip it, and the choice is
 * remembered per browser.
 *
 * Below 768px it is neither: a phone can't spare even the 56px rail (it was
 * 15% of the screen, and every row on every page was squeezed to fit). It
 * becomes a slim top bar (menu button, wordmark, account avatar) and the nav
 * moves into a drawer that slides in from the left. The drawer is a native
 * <dialog> opened with showModal(), which supplies the focus trap, the inert
 * page behind it and Escape, like ApplicationDialog.
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
  { id: "progress", label: "Progress", icon: "trendingUp" },
  { id: "jobs", label: "Job Matches", icon: "briefcase" },
  { id: "applications", label: "Applications", icon: "kanban" },
  { id: "resume", label: "Resume", icon: "fileText" },
  { id: "plans", label: "Plans", icon: "gem" },
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
  const collapsed = !narrow && userCollapsed;

  // --- phone drawer ---------------------------------------------------------
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerRef = useRef(null);
  const menuButtonRef = useRef(null);
  const pressStartedOnBackdrop = useRef(false);
  const drawerId = useId();

  // Mirror the state onto the dialog. Closing hands focus back to the menu
  // button, so a keyboard user isn't dropped at the top of the document.
  useEffect(() => {
    const dialog = drawerRef.current;
    if (!dialog) return undefined;
    if (drawerOpen && !dialog.open) {
      dialog.showModal();
      // The page behind a modal can still scroll on touch; hold it still.
      const root = document.documentElement;
      const previous = root.style.overflow;
      root.style.overflow = "hidden";
      return () => {
        root.style.overflow = previous;
      };
    }
    if (!drawerOpen && dialog.open) {
      dialog.close();
      menuButtonRef.current?.focus();
    }
    return undefined;
  }, [drawerOpen]);

  // Widening past the breakpoint unmounts the drawer; don't let it reopen by
  // itself on the way back down. A live interview starting closes it too.
  useEffect(() => {
    if (!narrow || !interactive) setDrawerOpen(false);
  }, [narrow, interactive]);

  function navigateFromDrawer(id) {
    setDrawerOpen(false);
    onNavigate?.(id);
  }

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
  // There's nothing to collapse on a phone, so the shortcut is off there.
  useEffect(() => {
    if (narrow) return undefined;
    function onKeyDown(e) {
      if (e.key !== "[" || e.defaultPrevented) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      e.preventDefault();
      toggle();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [toggle, narrow]);

  const disabledTip = "Finish or end the interview to navigate away";

  if (narrow) {
    const activeLabel = NAV.find((item) => item.id === active)?.label;
    return (
      <>
        <header className={`${styles.bar} no-print`}>
          <button
            ref={menuButtonRef}
            type="button"
            className={styles.menuButton}
            onClick={() => setDrawerOpen(true)}
            disabled={!interactive}
            aria-label={activeLabel ? `Open menu. Current section: ${activeLabel}` : "Open menu"}
            aria-haspopup="dialog"
            aria-expanded={drawerOpen}
            aria-controls={drawerId}
            title={interactive ? undefined : disabledTip}
          >
            <Icon name="menu" />
          </button>
          <span className={styles.barWordmark}>Jobuddy</span>
          {onSignOut && (
            <AccountMenu
              user={user}
              collapsed
              placement="down"
              onSignOut={onSignOut}
              onOpenSurvey={onOpenSurvey}
              surveyState={surveyState}
              interactive={interactive}
            />
          )}
        </header>

        <dialog
          ref={drawerRef}
          id={drawerId}
          className={`${styles.drawer} no-print`}
          aria-label="App menu"
          // Escape: let the state close it, so focus goes back to the button.
          onCancel={(e) => {
            e.preventDefault();
            setDrawerOpen(false);
          }}
          // A click on the backdrop lands on the <dialog> itself (the panel
          // inside fills it). Only close when the press began there too, so a
          // drag that ends outside doesn't dismiss it.
          onPointerDown={(e) => {
            pressStartedOnBackdrop.current = e.target === e.currentTarget;
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && pressStartedOnBackdrop.current) {
              setDrawerOpen(false);
            }
          }}
        >
          <div className={styles.drawerPanel}>
            <div className={styles.drawerHead}>
              <span className={styles.wordmark}>Jobuddy</span>
              <button
                type="button"
                className={styles.toggle}
                onClick={() => setDrawerOpen(false)}
                aria-label="Close menu"
              >
                <Icon name="x" />
              </button>
            </div>
            <nav className={styles.nav} aria-label="Sections">
              {NAV.map((item) => {
                const isActive = active === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`${styles.item} ${styles.drawerItem} ${isActive ? styles.active : ""}`}
                    onClick={() => navigateFromDrawer(item.id)}
                    aria-current={isActive ? "page" : undefined}
                  >
                    <Icon name={item.icon} />
                    <span className={styles.label}>{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </div>
        </dialog>
      </>
    );
  }

  return (
    <aside
      className={`${styles.sidebar} ${collapsed ? styles.collapsed : ""} no-print`}
      aria-label="App"
    >
      <div className={styles.top}>
        {!collapsed && <span className={styles.wordmark}>Jobuddy</span>}
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
