import BrandMark from "./BrandMark.jsx";
import styles from "./AppSkeleton.module.css";

/**
 * What a signed-in page looks like before it can show anything real.
 *
 * Both waits that precede a protected screen used to render nothing at all — an
 * empty `.app-shell` while the stored Supabase session was read, and a `null`
 * Suspense fallback while the workspace chunk downloaded — so every refresh of
 * /dashboard, /jobs or /resume was a second of blank dark page.
 *
 * Showing the chrome plus a couple of placeholder blocks keeps the page
 * identifiable and makes the wait read as loading rather than as breakage.
 * `aria-busy` and the polite status line cover the non-visual version.
 */
export default function AppSkeleton({ label = "Loading…" }) {
  return (
    <div className="app-shell" aria-busy="true">
      <div className={styles.bar}>
        <span className={styles.wordmark}>
          <BrandMark />
          <span className={styles.wordmarkText}>Mock Interview</span>
        </span>
      </div>

      <div className={styles.body} aria-hidden="true">
        <div className={`skeleton ${styles.title}`} />
        <div className={`skeleton ${styles.line}`} />
        <div className={styles.cards}>
          <div className={`skeleton ${styles.card}`} />
          <div className={`skeleton ${styles.card}`} />
          <div className={`skeleton ${styles.card}`} />
        </div>
      </div>

      <p className="sr-only" role="status">
        {label}
      </p>
    </div>
  );
}
