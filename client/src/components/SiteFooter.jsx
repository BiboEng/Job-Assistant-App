import Icon from "./Icon.jsx";
import styles from "./SiteFooter.module.css";

/**
 * The landing page's Contact section — footer-style, deliberately small, and
 * the target of /contact. The heading takes focus when scrolled to (see
 * LandingScreen), hence `tabIndex={-1}`.
 */

const CONTACT_EMAIL = "bibo2.muamar@gmail.com";
const GITHUB_URL = "https://github.com/BiboEng";

export default function SiteFooter() {
  return (
    <footer id="contact" className={styles.footer} aria-labelledby="contact-heading">
      <div className={styles.inner}>
        <div className={styles.intro}>
          <h2 id="contact-heading" className={styles.heading} tabIndex={-1}>
            Contact
          </h2>
          <p className={styles.body}>
            Questions, feedback, or a bug to report? Get in touch.
          </p>
        </div>

        <ul className={styles.links}>
          <li>
            <a className={styles.link} href={`mailto:${CONTACT_EMAIL}`}>
              <Icon name="mail" size={16} />
              <span>
                <span className={styles.linkLabel}>Email</span>
                <span className={styles.linkValue}>{CONTACT_EMAIL}</span>
              </span>
            </a>
          </li>
          <li>
            <a
              className={styles.link}
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Icon name="github" size={16} />
              <span>
                <span className={styles.linkLabel}>GitHub</span>
                <span className={styles.linkValue}>github.com/BiboEng</span>
              </span>
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          </li>
        </ul>
      </div>

      <div className={styles.legal}>
        <span>© {new Date().getFullYear()} Mock Interview</span>
      </div>
    </footer>
  );
}
