import { useEffect, useState } from "react";
import Icon from "./Icon.jsx";
import styles from "./Toast.module.css";

const TONE_ICON = { success: "check", error: "alert", info: "sparkles" };

/**
 * A transient confirmation, pinned to the bottom of the viewport.
 *
 * Used for outcomes the user should notice but not have to act on — "saved to
 * your history", "PDF downloaded". Anything that needs a decision stays an
 * inline banner instead, where it can't time out before it's read.
 *
 * `role="status"` (not `alert`) so a screen reader announces it politely
 * without interrupting whatever the user is doing.
 *
 * The last message is held on to after `message` clears so it can animate out;
 * it unmounts on `animationend` (which still fires under reduced motion, where
 * the global rule shrinks every animation to ~0ms).
 */
export default function Toast({ message, tone = "success", duration = 3200, onDismiss }) {
  const [shown, setShown] = useState(message ? { message, tone } : null);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (message) {
      setShown({ message, tone });
      setLeaving(false);
    } else {
      setLeaving(true);
    }
  }, [message, tone]);

  useEffect(() => {
    if (!message || !duration) return;
    const t = setTimeout(() => onDismiss?.(), duration);
    return () => clearTimeout(t);
  }, [message, duration, onDismiss]);

  if (!shown) return null;

  return (
    <div className={styles.wrap} role="status" aria-live="polite">
      <div
        // Keyed on the text so a new message replays the entrance.
        key={shown.message}
        className={`${styles.toast} ${styles[shown.tone] || ""} ${
          leaving ? styles.leaving : ""
        }`}
        onAnimationEnd={(e) => {
          if (leaving && e.target === e.currentTarget) setShown(null);
        }}
      >
        <Icon name={TONE_ICON[shown.tone] || "check"} />
        <span>{shown.message}</span>
        {onDismiss && !leaving && (
          <button
            type="button"
            className={styles.close}
            onClick={onDismiss}
            aria-label="Dismiss"
          >
            <Icon name="x" />
          </button>
        )}
      </div>
    </div>
  );
}
