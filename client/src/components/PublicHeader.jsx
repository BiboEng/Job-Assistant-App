import { Link, NavLink, useLocation } from "react-router";
import Icon from "./Icon.jsx";
import BrandMark from "./BrandMark.jsx";
import ThemeToggle from "./ThemeToggle.jsx";
import { useAuth } from "../auth/AuthProvider.jsx";
import { PATHS } from "../routes.js";
import styles from "./PublicHeader.module.css";

/**
 * The public site's top bar: wordmark, the three landing sections, and Sign In.
 *
 * The section links are real routes (/about, /how-it-works, /contact) that all
 * render the landing page — LandingScreen scrolls to the matching section — so
 * they can be bookmarked and shared, and work from /sign-in too.
 *
 * Sign In is a filled button, not a fourth link: it's the one action the page
 * exists to lead to. A visitor who is already signed in gets "Dashboard" in its
 * place, and the button is dropped on /sign-in itself.
 */

const LINKS = [
  { to: PATHS.about, label: "About" },
  { to: PATHS.howItWorks, label: "How It Works" },
  { to: PATHS.contact, label: "Contact" },
];

export default function PublicHeader() {
  const { user, loading } = useAuth();
  const { pathname } = useLocation();
  const onSignIn = pathname === PATHS.signIn;

  return (
    <header className={styles.bar}>
      {/* Every public page renders its body into #main-content. */}
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <div className={styles.inner}>
        <Link to={PATHS.home} className={styles.wordmark}>
          <BrandMark />
          <span className={styles.wordmarkText}>Mock Interview</span>
        </Link>

        <nav className={styles.nav} aria-label="Site">
          {LINKS.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) =>
                `${styles.navItem} ${isActive ? styles.navActive : ""}`
              }
            >
              {link.label}
            </NavLink>
          ))}
        </nav>

        <div className={styles.tail}>
          <span className={styles.theme}>
            <ThemeToggle />
          </span>
          {!onSignIn &&
            !loading &&
            (user ? (
              <Link to={PATHS.dashboard} className={`btn-primary btn-sm ${styles.cta}`}>
                Dashboard
                <Icon name="chevronRight" size={15} />
              </Link>
            ) : (
              <Link to={PATHS.signIn} className={`btn-primary btn-sm ${styles.cta}`}>
                <Icon name="logIn" size={15} />
                Sign In
              </Link>
            ))}
        </div>
      </div>
    </header>
  );
}
