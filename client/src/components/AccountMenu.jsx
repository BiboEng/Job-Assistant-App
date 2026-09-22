import { useEffect, useId, useRef, useState } from "react";
import Icon from "./Icon.jsx";
import styles from "./AccountMenu.module.css";

/**
 * The account control in the header: who you're signed in as, the career
 * survey, and Sign out.
 *
 * It replaced a bare "Sign out" button because the survey needs a permanent
 * home — someone who skips the dashboard banner has to be able to find it
 * again, and "settings" isn't a screen this app has. The menu item changes
 * label with `surveyState`, so it reads as an invitation the first time and as
 * an edit afterwards; when the survey is unavailable (no Supabase, or the
 * migration hasn't been applied) the item isn't rendered at all.
 *
 * Disabled wholesale during a live interview, for the same reason the nav is:
 * both roads out of this menu abandon the session.
 */
export default function AccountMenu({
  userEmail,
  onSignOut,
  onOpenSurvey,
  surveyState = "unavailable",
  interactive = true,
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const buttonRef = useRef(null);
  const menuId = useId();

  // Any click outside closes it, and Escape closes it and returns focus to the
  // button — otherwise a keyboard user is left adrift in the page.
  useEffect(() => {
    if (!open) return undefined;

    function onPointerDown(e) {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    }
    function onKeyDown(e) {
      if (e.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // A live interview disables the trigger; make sure an already-open menu goes
  // with it rather than hanging there with dead items.
  useEffect(() => {
    if (!interactive) setOpen(false);
  }, [interactive]);

  function run(action) {
    setOpen(false);
    action?.();
  }

  const showSurvey =
    surveyState !== "unavailable" && surveyState !== "loading" && Boolean(onOpenSurvey);

  const surveyLabel =
    surveyState === "completed"
      ? "Edit survey answers"
      : surveyState === "dismissed"
      ? "Finish career survey"
      : "Take career survey";

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        className={`${styles.trigger} ${open ? styles.triggerOpen : ""}`}
        onClick={() => setOpen((v) => !v)}
        disabled={!interactive}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={userEmail ? `Account: ${userEmail}` : "Account"}
        title={
          interactive
            ? undefined
            : "Finish or end the interview to change account settings"
        }
      >
        <span className={styles.avatar} aria-hidden="true">
          {initialOf(userEmail)}
        </span>
        <Icon name="chevronDown" size={14} className={styles.caret} />
      </button>

      {open && (
        <div className={styles.menu} id={menuId} role="menu">
          {userEmail && (
            <div className={styles.identity}>
              <span className={styles.identityLabel}>Signed in as</span>
              <span className={styles.identityEmail} title={userEmail}>
                {userEmail}
              </span>
            </div>
          )}

          {showSurvey && (
            <button
              type="button"
              role="menuitem"
              className={styles.item}
              onClick={() => run(onOpenSurvey)}
            >
              <Icon name="sparkles" size={15} />
              <span>{surveyLabel}</span>
            </button>
          )}

          <button
            type="button"
            role="menuitem"
            className={`${styles.item} ${styles.danger}`}
            onClick={() => run(onSignOut)}
          >
            <Icon name="logOut" size={15} />
            <span>Sign out</span>
          </button>
        </div>
      )}
    </div>
  );
}

/** First letter of the email, or a neutral glyph when there isn't one. */
function initialOf(email) {
  const ch = (email || "").trim().charAt(0);
  return ch ? ch.toUpperCase() : "•";
}
