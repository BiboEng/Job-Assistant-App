import { useEffect } from "react";
import { Link } from "react-router";
import PublicHeader from "../components/PublicHeader.jsx";
import SiteFooter from "../components/SiteFooter.jsx";
import Icon from "../components/Icon.jsx";
import { useAuth } from "../auth/AuthProvider.jsx";
import { PATHS } from "../routes.js";
import styles from "./NotFoundScreen.module.css";

/**
 * Any path the route table doesn't know: the thinking mascot, one line, and
 * a way back. Public, so it works signed in or out.
 *
 * It's a single-page app, so the host still answers these URLs with a 200
 * and index.html; this is what the visitor sees, not the HTTP status.
 */
export default function NotFoundScreen() {
  const { user } = useAuth();

  useEffect(() => {
    const previous = document.title;
    document.title = "Page not found · Jobuddy";
    return () => {
      document.title = previous;
    };
  }, []);

  return (
    <div className="public-site">
      <PublicHeader />
      <main id="main-content" tabIndex={-1} className={styles.page}>
        <img
          src="/landing/mascot/thinking.webp"
          width="560"
          height="683"
          alt=""
          className={styles.mascot}
          decoding="async"
        />
        <p className={`mono ${styles.code}`}>404</p>
        <h1 className={styles.title}>Hmm, I can&apos;t find that page.</h1>
        <p className={styles.body}>The link may be old, or the address has a typo.</p>
        <div className={styles.actions}>
          <Link to={PATHS.home} className={`btn-primary btn-lg ${styles.link}`}>
            Back to home
          </Link>
          {user && (
            <Link to={PATHS.dashboard} className={`btn-ghost btn-lg ${styles.link}`}>
              Open dashboard
              <Icon name="chevronRight" />
            </Link>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
