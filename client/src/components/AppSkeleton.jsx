import styles from "./AppSkeleton.module.css";

/**
 * What a signed-in page looks like before it can show anything real.
 *
 * Both waits that precede a protected screen used to render nothing at all — an
 * empty shell while the stored Supabase session was read, and a `null`
 * Suspense fallback while the workspace chunk downloaded — so every refresh of
 * /dashboard, /jobs or /resume was a second of blank dark page.
 *
 * It mirrors the real frame — sidebar with the wordmark, then a page header
 * and a few list rows — so nothing jumps when the app replaces it. The nav is
 * left out: guessing at it would be worse than leaving it out, since we don't
 * yet know whether the person is signed in. `aria-busy` and the polite status
 * line cover the non-visual version.
 */
export default function AppSkeleton({ label = "Loading…" }) {
  return (
    <div className="app-frame" aria-busy="true">
      <div className={styles.sidebar}>
        <span className={styles.wordmark}>Jobassist</span>
      </div>

      <div className="app-main app-shell">
        <div className={styles.body} aria-hidden="true">
          <div className={`skeleton ${styles.title}`} />
          <div className={styles.rows}>
            <div className={`skeleton ${styles.row}`} />
            <div className={`skeleton ${styles.row}`} />
            <div className={`skeleton ${styles.row}`} />
            <div className={`skeleton ${styles.row}`} />
          </div>
        </div>

        <p className="sr-only" role="status">
          {label}
        </p>
      </div>
    </div>
  );
}
