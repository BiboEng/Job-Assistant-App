import Icon from "./Icon.jsx";
import styles from "./PracticeAgainButton.module.css";

const HINT = "New questions for the same job description, question count, focus and answer mode";

/**
 * "Practice again": starts a fresh interview in the same format as an earlier
 * one, skipping the setup form. The work happens in AppWorkspace
 * (`practiceAgain`); this is only the control, so every place that offers it
 * looks and behaves the same.
 *
 * `busy` is this button's own request (it spins and says "Starting…");
 * `disabled` is another one in flight — only one interview can be starting.
 *
 * `variant="icon"` is the compact square used on history rows, where the
 * label becomes the accessible name and the tooltip.
 */
export default function PracticeAgainButton({
  onClick,
  busy = false,
  disabled = false,
  variant = "primary",
  label = "Practice again",
  name,
}) {
  const icon = busy ? (
    <span className={styles.spin}>
      <Icon name="loader" />
    </span>
  ) : (
    <Icon name="repeat" />
  );

  if (variant === "icon") {
    return (
      <button
        type="button"
        className={styles.iconBtn}
        onClick={onClick}
        disabled={busy || disabled}
        aria-label={name ? `${label}: ${name}` : label}
        aria-busy={busy || undefined}
        title={busy ? "Starting…" : `${label} — ${HINT.toLowerCase()}`}
      >
        {icon}
      </button>
    );
  }

  return (
    <button
      type="button"
      className={variant === "ghost" ? "btn-ghost" : "btn-primary"}
      onClick={onClick}
      disabled={busy || disabled}
      aria-busy={busy || undefined}
      title={HINT}
    >
      {icon}
      {busy ? "Starting…" : label}
    </button>
  );
}
