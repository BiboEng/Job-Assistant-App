import { useEffect, useId, useRef, useState } from "react";
import Icon from "./Icon.jsx";
import styles from "./AccountMenu.module.css";

/**
 * The account control at the foot of the sidebar: avatar + name, opening a
 * small menu with the signed-in email, the career survey, and Sign out.
 *
 * The survey lives here because it needs a permanent home — someone who skips
 * the dashboard banner has to be able to find it again, and "settings" isn't a
 * screen this app has. The item changes label with `surveyState`, so it reads
 * as an invitation the first time and as an edit afterwards; when the survey is
 * unavailable (no Supabase, or the migration hasn't been applied) it isn't
 * rendered at all.
 *
 * The avatar is the provider's picture (Google, GitHub) when there is one, and
 * an initial otherwise — email/password accounts have no picture to show.
 *
 * Disabled wholesale during a live interview, for the same reason the nav is:
 * both roads out of this menu abandon the session.
 */
export default function AccountMenu({
  user,
  collapsed = false,
  onSignOut,
  onOpenSurvey,
  surveyState = "unavailable",
  interactive = true,
}) {
  const [open, setOpen] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const wrapRef = useRef(null);
  const buttonRef = useRef(null);
  const menuId = useId();

  const email = user?.email || "";
  const meta = user?.user_metadata || {};
  const name = meta.full_name || meta.name || meta.user_name || email || "Account";
  const avatarUrl = meta.avatar_url || meta.picture || "";

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
    <div className={`${styles.wrap} ${collapsed ? styles.collapsed : ""}`} ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        className={`${styles.trigger} ${open ? styles.triggerOpen : ""}`}
        onClick={() => setOpen((v) => !v)}
        disabled={!interactive}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Account: ${name}`}
        title={
          interactive
            ? collapsed
              ? name
              : undefined
            : "Finish or end the interview to change account settings"
        }
      >
        {avatarUrl && !avatarFailed ? (
          <img
            className={styles.avatar}
            src={avatarUrl}
            alt=""
            referrerPolicy="no-referrer"
            onError={() => setAvatarFailed(true)}
          />
        ) : (
          <span className={styles.avatar} aria-hidden="true">
            {initialOf(name)}
          </span>
        )}
        {!collapsed && (
          <>
            <span className={styles.name}>{name}</span>
            <Icon name="chevronsUpDown" className={styles.caret} />
          </>
        )}
      </button>

      {open && (
        <div className={styles.menu} id={menuId} role="menu">
          {email && (
            <div className={styles.identity}>
              <span className={styles.identityLabel}>Signed in as</span>
              <span className={styles.identityEmail} title={email}>
                {email}
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
              <Icon name="clipboard" />
              <span>{surveyLabel}</span>
            </button>
          )}

          <button
            type="button"
            role="menuitem"
            className={`${styles.item} ${styles.danger}`}
            onClick={() => run(onSignOut)}
          >
            <Icon name="logOut" />
            <span>Sign out</span>
          </button>
        </div>
      )}
    </div>
  );
}

/** First letter of the name, or a neutral glyph when there isn't one. */
function initialOf(text) {
  const ch = (text || "").trim().charAt(0);
  return ch ? ch.toUpperCase() : "•";
}
