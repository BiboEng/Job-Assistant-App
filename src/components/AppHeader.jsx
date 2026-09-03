import styles from "./AppHeader.module.css";

/**
 * Slim persistent top bar. The wordmark navigates home except during an active
 * interview (interactive=false), where leaving would abandon the session.
 */
export default function AppHeader({ onHome, interactive = true }) {
  const content = (
    <>
      <span aria-hidden="true">🎤</span> Mock Interview
    </>
  );

  return (
    <header className={styles.bar}>
      {interactive ? (
        <button type="button" className={styles.wordmark} onClick={onHome}>
          {content}
        </button>
      ) : (
        <span className={styles.wordmark}>{content}</span>
      )}
    </header>
  );
}
