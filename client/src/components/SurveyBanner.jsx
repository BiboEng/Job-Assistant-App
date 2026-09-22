import Icon from "./Icon.jsx";
import styles from "./SurveyBanner.module.css";

/**
 * The one-time invitation to take the career survey, shown on the dashboard.
 *
 * It appears only when the user has no survey row at all — taking it *or*
 * skipping it writes one, and the banner never comes back on its own. After
 * that the survey lives in the account menu, so "skip for now" genuinely means
 * "not now" rather than "never".
 *
 * Deliberately not an `.info-banner`: this is an offer, not a status, and it
 * carries two buttons of its own.
 */
export default function SurveyBanner({ onTake, onSkip }) {
  return (
    <section className={styles.banner} aria-labelledby="survey-banner-title">
      <span className={styles.icon} aria-hidden="true">
        <Icon name="sparkles" size={19} />
      </span>

      <div className={styles.copy}>
        <h2 id="survey-banner-title" className={styles.title}>
          Help us personalize your experience
        </h2>
        <p className={styles.body}>
          Fifteen quick questions about your job search — takes 2 minutes, and every
          one is optional.
        </p>
      </div>

      <div className={styles.actions}>
        <button type="button" className="btn-primary btn-sm" onClick={onTake}>
          Take survey
        </button>
        <button type="button" className="btn-ghost btn-sm" onClick={onSkip}>
          Skip for now
        </button>
      </div>
    </section>
  );
}
