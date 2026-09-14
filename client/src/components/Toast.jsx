import { useEffect } from "react";
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
 */
export default function Toast({ message, tone = "success", duration = 3200, onDismiss }) {
  useEffect(() => {
    if (!message || !duration) return;
    const t = setTimeout(() => onDismiss?.(), duration);
    return () => clearTimeout(t);
  }, [message, duration, onDismiss]);

  if (!message) return null;

  return (
    <div className={styles.wrap} role="status" aria-live="polite">
      <div className={`${styles.toast} ${styles[tone] || ""}`}>
        <Icon name={TONE_ICON[tone] || "check"} size={16} />
        <span>{message}</span>
        {onDismiss && (
          <button
            type="button"
            className={styles.close}
            onClick={onDismiss}
            aria-label="Dismiss"
          >
            <Icon name="x" size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
