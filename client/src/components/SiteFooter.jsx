import { Link } from "react-router";
import Icon from "./Icon.jsx";
import { BUSINESS } from "../legal/business.js";
import { PATHS } from "../routes.js";
import styles from "./SiteFooter.module.css";

/**
 * The public pages' footer, and the landing page's Contact section (the
 * target of /contact). Deliberately small: the wordmark, two ways to get in
 * touch, and the legal row. The heading takes focus when scrolled to (see
 * LandingScreen), hence `tabIndex={-1}`.
 *
 * Its bottom row carries the legal links and who operates the site, which
 * belong on every public page once the site sells anything.
 */

const CONTACT_EMAIL = BUSINESS.contactEmail;
const GITHUB_URL = "https://github.com/BiboEng";

export default function SiteFooter() {
  const operator = BUSINESS.legalName.trim();
  return (
    <footer id="contact" className={styles.footer} aria-labelledby="contact-heading">
      <div className={styles.inner}>
        <div className={styles.brand}>
          <span className={styles.wordmark}>{BUSINESS.tradeName}</span>
          <p className={styles.tagline}>Interview practice, job matches and resumes in one place.</p>
        </div>

        <div className={styles.contact}>
          <h2 id="contact-heading" className={styles.heading} tabIndex={-1}>
            Contact
          </h2>
          <p className={styles.body}>Questions, feedback, or a bug to report?</p>
          <ul className={styles.links}>
            <li>
              <a className={styles.link} href={`mailto:${CONTACT_EMAIL}`}>
                <Icon name="mail" />
                {CONTACT_EMAIL}
              </a>
            </li>
            <li>
              <a
                className={styles.link}
                href={GITHUB_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Icon name="github" />
                github.com/BiboEng
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            </li>
          </ul>
        </div>
      </div>

      <div className={styles.legal}>
        <span>
          © {new Date().getFullYear()} {BUSINESS.tradeName}
          {operator ? `. Operated by ${operator}.` : ""}
        </span>
        <nav className={styles.legalLinks} aria-label="Legal">
          <Link to={PATHS.terms}>Terms</Link>
          <Link to={PATHS.privacy}>Privacy</Link>
          <Link to={PATHS.refunds}>Refunds &amp; cancellation</Link>
        </nav>
      </div>
    </footer>
  );
}
