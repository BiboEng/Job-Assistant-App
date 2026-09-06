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
    return <div className={styles.system}>{text}</div>;
  }

  const label = LABELS[role];

  return (
    <div className={`${styles.row} ${role === "candidate" ? styles.right : styles.left}`}>
      <div className={styles.bubbleWrap}>
        <span className={styles.label}>{label}</span>
        <div
          className={`${styles.bubble} ${styles[role]} ${typing ? styles.typing : ""}`}
          aria-label={typing ? "Interviewer is typing" : `${label}: ${text}`}
        >
          {typing ? <span aria-hidden="true">…</span> : text}
        </div>
      </div>
    </div>
  );
}
