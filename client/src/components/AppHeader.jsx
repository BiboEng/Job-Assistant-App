import Icon from "./Icon.jsx";
import ThemeToggle from "./ThemeToggle.jsx";
import BrandMark from "./BrandMark.jsx";
import AccountMenu from "./AccountMenu.jsx";
import styles from "./AppHeader.module.css";

/**
 * Persistent top bar: wordmark, feature nav, theme control, sign out.
 *
 * The nav exists because the three features used to be reachable only from the
 * Home screen — getting from Job Matches to the Resume Builder meant going back
 * first. `active` is the *section*, not the screen: setup/chat/results/history
 * all belong to "practice".
 *
 * During a live interview (`interactive=false`) the nav is disabled rather than
 * hidden: leaving would abandon the session, but the user should still see
 * where they are. Sign out follows the same rule — it would abandon the
 * interview just as surely as navigating away.
 *
 * Sign out used to be a button of its own here. It now lives in AccountMenu,
 * alongside the career survey — which needs a permanent home, because someone
 * who skips the dashboard banner has no other way back to it.
 *
 * `onSignOut` / `userEmail` / the survey props come from AppWorkspace; the
 * header stays free of auth and router imports so it remains a plain
 * presentational component.
 */

const NAV = [
  { id: "practice", label: "Practice", icon: "messageSquare" },
  { id: "jobs", label: "Job matches", icon: "briefcase" },
  { id: "resume", label: "Resume", icon: "fileText" },
];

export default function AppHeader({
  onHome,
  onNavigate,
  onSignOut,
  onOpenSurvey,
  surveyState,
  userEmail,
  active,
  interactive = true,
}) {
  return (
    <header className={styles.bar}>
      {interactive ? (
        <button type="button" className={styles.wordmark} onClick={onHome}>
          <BrandMark />
          <span className={styles.wordmarkText}>Mock Interview</span>
        </button>
      ) : (
        <span className={styles.wordmark}>
          <BrandMark />
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
        {onSignOut && (
          <AccountMenu
            userEmail={userEmail}
            onSignOut={onSignOut}
            onOpenSurvey={onOpenSurvey}
            surveyState={surveyState}
            interactive={interactive}
          />
        )}
      </div>
    </header>
  );
}

