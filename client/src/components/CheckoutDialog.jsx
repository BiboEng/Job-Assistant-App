import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router";
import Icon from "./Icon.jsx";
import { startCheckout } from "../api/billingApi.js";
import { PLAN_COPY, formatPrice, taxNote } from "../billing/plans.js";
import { missingBusinessDetails } from "../legal/business.js";
import { PATHS } from "../routes.js";
import styles from "./CheckoutDialog.module.css";

/**
 * The step before Stripe Checkout: what you're buying, what it costs, that it
 * renews automatically, how to cancel, and the refund window — stated plainly
 * before any payment page, which is what auto-renewal and consumer-protection
 * rules ask for. Checkout itself repeats the renewal terms and requires
 * ticking agreement to the Terms of Service.
 *
 * "Continue" asks the server for a Checkout Session and sends the browser to
 * Stripe's hosted page. Nothing about the card is ever entered here.
 */
export default function CheckoutDialog({ plan, interval, price, automaticTax, onClose }) {
  const dialogRef = useRef(null);
  const pressStartedOnBackdrop = useRef(false);
  const titleId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const name = PLAN_COPY[plan]?.name ?? "this plan";
  const period = interval === "year" ? "year" : "month";
  const missing = missingBusinessDetails();
  const blocked = missing.length > 0 || !price;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  function requestClose() {
    if (!busy) onClose?.();
  }

  async function handleContinue() {
    if (blocked || busy) return;
    setBusy(true);
    setError("");
    try {
      const { url } = await startCheckout(plan, interval);
      // Always an https page on Stripe (or a custom checkout domain set up in
      // Stripe) — never anything else.
      if (!url || !/^https:\/\//.test(url)) {
        throw new Error("Checkout couldn't be started. Please try again.");
      }
      window.location.assign(url);
    } catch (err) {
      setError(err.message || "Checkout couldn't be started. Please try again.");
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        requestClose();
      }}
      onMouseDown={(e) => {
        pressStartedOnBackdrop.current = e.target === dialogRef.current;
      }}
      onClick={(e) => {
        if (e.target === dialogRef.current && pressStartedOnBackdrop.current) requestClose();
      }}
    >
      <div className={styles.panel}>
        <header className={styles.head}>
          <div>
            <p className="eyebrow">Upgrade</p>
            <h2 id={titleId} className={styles.title}>
              {name}, billed {interval === "year" ? "yearly" : "monthly"}
            </h2>
          </div>
          <button
            type="button"
            className="btn-subtle"
            onClick={requestClose}
            aria-label="Close"
            disabled={busy}
          >
            <Icon name="x" />
          </button>
        </header>

        <p className={styles.price}>
          <span className="mono">{formatPrice(price) ?? "—"}</span> per {period}
          {taxNote(price, { automaticTax }) && (
            <span className={styles.tax}> · {taxNote(price, { automaticTax })}</span>
          )}
        </p>

        <ul className={styles.terms}>
          <li>
            <Icon name="refresh" />
            <span>
              You're charged today, then automatically every {period} on the same date until you
              cancel.
            </span>
          </li>
          <li>
            <Icon name="x" />
            <span>
              Cancel any time in Plans → Manage billing. You keep {name} until the end of the{" "}
              {period} you've paid for, and you're not charged again.
            </span>
          </li>
          <li>
            <Icon name="undo" />
            <span>Not happy? Email us within 14 days of your first payment for a full refund.</span>
          </li>
          <li>
            <Icon name="lock" />
            <span>Payment is handled by Stripe. Your card details never reach Jobassist.</span>
          </li>
        </ul>

        <p className={styles.legal}>
          On the next page you'll be asked to agree to the{" "}
          <Link to={PATHS.terms} target="_blank" rel="noopener">
            Terms of Service
          </Link>
          . See also the{" "}
          <Link to={PATHS.refunds} target="_blank" rel="noopener">
            Refund &amp; Cancellation Policy
          </Link>{" "}
          and the{" "}
          <Link to={PATHS.privacy} target="_blank" rel="noopener">
            Privacy Policy
          </Link>
          .
        </p>

        {missing.length > 0 && (
          <div className="warn-banner" role="status">
            <Icon name="alert" />
            <span>
              Checkout is switched off until the seller's details are filled in (missing:{" "}
              {missing.join(", ")}).
            </span>
          </div>
        )}

        {error && (
          <div className="error-banner" role="alert">
            <Icon name="alert" />
            <span>{error}</span>
          </div>
        )}

        <div className={styles.actions}>
          <button type="button" className="btn-ghost" onClick={requestClose} disabled={busy}>
            Not now
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={handleContinue}
            disabled={blocked || busy}
          >
            <Icon name={busy ? "loader" : "lock"} />
            {busy ? "Opening checkout…" : "Continue to secure checkout"}
          </button>
        </div>
      </div>
    </dialog>
  );
}
