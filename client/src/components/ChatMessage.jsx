import Icon from "./Icon.jsx";
import styles from "./ChatMessage.module.css";

const LABELS = {
  interviewer: "Interviewer",
  candidate: "You",
  system: null,
};

export default function ChatMessage({ role, text, typing = false }) {
  if (role === "system") {
    // No role="status" here: this renders inside the thread's aria-live="polite"
    // region, which already announces additions — a second live role would make
    // screen readers read each system line twice.
    return (
      <div className={styles.system}>
        <span className={styles.systemLine} aria-hidden="true" />
        <span>{text}</span>
        <span className={styles.systemLine} aria-hidden="true" />
      </div>
    );
  }

  const label = LABELS[role];
  const isCandidate = role === "candidate";

  return (
    <div className={`${styles.row} ${isCandidate ? styles.right : styles.left}`}>
      {!isCandidate && (
        <span className={styles.avatar} aria-hidden="true">
          <Icon name="messageSquare" />
        </span>
      )}

      <div className={styles.bubbleWrap}>
        <span className={styles.label}>{label}</span>
        <div
          className={`${styles.bubble} ${styles[role]}`}
          aria-label={typing ? "Interviewer is typing" : `${label}: ${text}`}
        >
          {typing ? (
            <span className={styles.typing} aria-hidden="true">
              <span className={styles.dot} />
              <span className={styles.dot} />
              <span className={styles.dot} />
            </span>
          ) : (
            text
          )}
        </div>
      </div>
    </div>
  );
}
