import { useEffect, useId, useState } from "react";
import { Link, useNavigate } from "react-router";
import PublicHeader from "../components/PublicHeader.jsx";
import Icon from "../components/Icon.jsx";
import { useAuth } from "../auth/AuthProvider.jsx";
import { PATHS } from "../routes.js";
import styles from "./SignInScreen.module.css";

/**
 * /reset-password — where the "set a new password" email lands.
 *
 * The link in the email carries a recovery token. `detectSessionInUrl` on the
 * Supabase client consumes it before React renders, so by the time this screen
 * mounts the person is holding a short-lived session and `updateUser` can set
 * the new password. That's why the route is public: they arrive here precisely
 * because they cannot sign in.
 *
 * If there's no session the link was never followed, has already been used, or
 * has expired — all three get the same message and a way to request another,
 * because we can't tell them apart and the difference doesn't help anyone.
 *
 * It borrows SignInScreen's stylesheet: same card, same fields, and keeping one
 * copy means the two screens can't drift apart visually.
 */

const MIN_PASSWORD = 8;

export default function ResetPasswordScreen() {
  const { user, loading, configured, updatePassword } = useAuth();
  const navigate = useNavigate();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const ids = useId();
  const passwordId = `${ids}-password`;
  const confirmId = `${ids}-confirm`;
  const hintId = `${ids}-hint`;

  // Once the password is changed, send them to the dashboard — the recovery
  // session is a real session, so there's nothing left to sign in to.
  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => navigate(PATHS.dashboard, { replace: true }), 1600);
    return () => clearTimeout(t);
  }, [done, navigate]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting) return;
    setError("");

    if (password.length < MIN_PASSWORD) {
      setError(`Use a password of at least ${MIN_PASSWORD} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("The two passwords don't match.");
      return;
    }

    setSubmitting(true);
    try {
      await updatePassword(password);
      setPassword("");
      setConfirm("");
      setDone(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  const noLink = !loading && !user;

  return (
    <div className="public-site">
      <PublicHeader />

      <main id="main-content" tabIndex={-1} className={`app-shell app-shell--public ${styles.page}`}>
        <div className={styles.card}>
          <div className={styles.head}>
            <span className={styles.icon} aria-hidden="true">
              <Icon name="lock" size={20} />
            </span>
            <h1 className={styles.title}>Choose a new password</h1>
            <p className={styles.subtitle}>
              {done
                ? "That's done — taking you to your dashboard."
                : "Set it once here and you'll be signed straight in."}
            </p>
          </div>

          {!configured && (
            <div className="warn-banner" role="alert">
              <Icon name="alert" size={16} />
              <span className={styles.bannerText}>
                Sign-in isn&apos;t configured, so passwords can&apos;t be changed here.
              </span>
            </div>
          )}

          {done && (
            <div className="info-banner" role="status">
              <Icon name="check" size={16} />
              <span className={styles.bannerText}>
                Your password has been changed.
              </span>
            </div>
          )}

          {noLink && !done && (
            <div className="warn-banner" role="status">
              <Icon name="alert" size={16} />
              <span className={styles.bannerText}>
                This reset link has expired or has already been used.{" "}
                <Link to={`${PATHS.signIn}?mode=forgot`}>Request a new one</Link>.
              </span>
            </div>
          )}

          {error && (
            <div className="error-banner" role="alert">
              <Icon name="alert" size={16} />
              <span className={styles.bannerText}>{error}</span>
            </div>
          )}

          {!done && !noLink && (
            <form className={styles.form} onSubmit={handleSubmit} noValidate>
              <div className={styles.field}>
                <span className={styles.labelRow}>
                  <label className={styles.label} htmlFor={passwordId}>
                    New password
                  </label>
                  <button
                    type="button"
                    className={styles.reveal}
                    onClick={() => setShowPassword((v) => !v)}
                    aria-pressed={showPassword}
                    aria-controls={passwordId}
                  >
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </span>
                <input
                  id={passwordId}
                  className={styles.input}
                  type={showPassword ? "text" : "password"}
                  name="new-password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={submitting || !configured}
                  minLength={MIN_PASSWORD}
                  aria-describedby={hintId}
                  required
                  autoFocus
                />
                <span id={hintId} className={styles.hint}>
                  At least {MIN_PASSWORD} characters.
                </span>
              </div>

              <div className={styles.field}>
                <label className={styles.label} htmlFor={confirmId}>
                  Confirm new password
                </label>
                <input
                  id={confirmId}
                  className={styles.input}
                  type={showPassword ? "text" : "password"}
                  name="confirm-password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  disabled={submitting || !configured}
                  required
                />
              </div>

              <button
                type="submit"
                className={`btn-primary ${styles.submit}`}
                disabled={submitting || !configured}
              >
                {submitting ? "Saving…" : "Save new password"}
              </button>
            </form>
          )}

          <p className={styles.alt}>
            <Link to={PATHS.signIn} className="link-btn">
              Back to sign in
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
