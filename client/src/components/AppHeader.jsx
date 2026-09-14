import Icon from "./Icon.jsx";
import ThemeToggle from "./ThemeToggle.jsx";
import styles from "./AppHeader.module.css";

/**
 * Persistent top bar: wordmark, feature nav, theme control.
 *
 * The nav exists because the three features used to be reachable only from the
 * Home screen — getting from Job Matches to the Resume Builder meant going back
 * first. `active` is the *section*, not the screen: setup/chat/results/history
 * all belong to "practice".
 *
 * During a live interview (`interactive=false`) the nav is disabled rather than
 * hidden: leaving would abandon the session, but the user should still see
 * where they are.
 */

const NAV = [
  { id: "practice", label: "Practice", icon: "messageSquare" },
  { id: "jobs", label: "Job matches", icon: "briefcase" },
  { id: "resume", label: "Resume", icon: "fileText" },
];

export default function AppHeader({ onHome, onNavigate, active, interactive = true }) {
  return (
    <header className={styles.bar}>
      {interactive ? (
        <button type="button" className={styles.wordmark} onClick={onHome}>
          <Mark />
          <span className={styles.wordmarkText}>Mock Interview</span>
        </button>
      ) : (
        <span className={styles.wordmark}>
          <Mark />
          <span className={styles.wordmarkText}>Mock Interview</span>
        </span>
      )}

      <nav className={styles.nav} aria-label="Sections">
        {NAV.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`${styles.navItem} ${active === item.id ? styles.navActive : ""}`}
            onClick={() => onNavigate?.(item.id)}
            disabled={!interactive}
            aria-current={active === item.id ? "page" : undefined}
            title={
              interactive ? undefined : "Finish or end the interview to navigate away"
            }
          >
            <Icon name={item.icon} size={16} />
            <span className={styles.navLabel}>{item.label}</span>
          </button>
        ))}
      </nav>

      <div className={styles.tail}>
        <ThemeToggle />
      </div>
    </header>
  );
}

/** The wordmark badge — the same gradient mic as the favicon. */
function Mark() {
  return (
    <span className={styles.mark} aria-hidden="true">
      <Icon name="mic" size={15} strokeWidth={2} />
    </span>
  );
}
