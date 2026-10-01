import Icon from "./Icon.jsx";
import styles from "./UpgradeNotice.module.css";

/**
 * "This isn't in your plan" — a daily allowance used up, or a feature a
 * higher plan includes. Amber, not red: nothing failed, and trying again won't
 * help, so the action on offer is "See plans" rather than "Try again".
 *
 * `compact` drops the banner chrome for use inside another surface (a locked
 * Progress section, the download menu).
 */
export default function UpgradeNotice({ message, onOpenPlans, compact = false, actionLabel = "See plans" }) {
  return (
    <div className={compact ? styles.compact : "warn-banner"} role="status">
      <Icon name="lock" />
      <span className={styles.message}>{message}</span>
      {onOpenPlans && (
        <button type="button" className={compact ? "btn-ghost btn-sm" : "btn-ghost"} onClick={onOpenPlans}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}
