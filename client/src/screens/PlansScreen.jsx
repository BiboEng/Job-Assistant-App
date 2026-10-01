import { useEffect, useRef, useState } from "react";
import Icon from "../components/Icon.jsx";
import PlanComparison from "../components/PlanComparison.jsx";
import CheckoutDialog from "../components/CheckoutDialog.jsx";
import { openBillingPortal, syncMyBilling } from "../api/billingApi.js";
import { PAID_PLANS, planName } from "../billing/plans.js";
import { usePlanCatalog } from "../billing/usePlanCatalog.js";
import styles from "./PlansScreen.module.css";

/**
 * Plans: which plan you're on, what you've used today, the three plans side
 * by side, and the way in and out of paying — Upgrade (a confirmation step,
 * then Stripe Checkout) and Manage billing (Stripe's Customer Portal, where
 * cancelling, switching plan and updating the card all happen).
 *
 * Coming back from Checkout, the plan is re-read from Stripe (POST
 * /api/billing/sync) a few times until it shows the upgrade, since the
 * browser can arrive before Stripe's webhook does. Access is only ever granted
 * from Stripe's record — the success redirect itself proves nothing.
 *
 * URL-free like every screen: AppWorkspace's PlansRoute turns the query string
 * into `requestedPlan` / `checkoutResult` / `portalReturned`.
 */

const SYNC_TRIES = 8;
const SYNC_EVERY_MS = 2500;

const USAGE_ROWS = [
  { kind: "interviews", label: "Mock interviews" },
  { kind: "jobSearches", label: "Job Matches searches" },
  { kind: "resumeMessages", label: "Resume Builder messages" },
];

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

function resetLabel(ms) {
  if (!Number.isFinite(ms)) return "";
  const time = new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const hours = Math.max(0, Math.round((ms - Date.now()) / 3_600_000));
  return `Resets at ${time} your time (midnight UTC)${hours ? `, in about ${hours}h` : ""}.`;
}

export default function PlansScreen({
  plan,
  requestedPlan = null,
  requestedInterval = null,
  checkoutResult = null,
  portalReturned = false,
  onClearParams,
}) {
  const catalog = usePlanCatalog();
  const data = plan.data;
  const current = data?.plan ?? null;
  const onPaidPlan = PAID_PLANS.includes(current);
  const sub = data?.subscription ?? null;

  const [interval, setInterval_] = useState(requestedInterval === "year" ? "year" : "month");
  const [checkout, setCheckout] = useState(null); // { plan }
  const [confirming, setConfirming] = useState(checkoutResult === "success" ? "waiting" : null);
  const [notice, setNotice] = useState(
    checkoutResult === "cancelled" ? "Checkout cancelled. You weren't charged." : ""
  );
  const [portalBusy, setPortalBusy] = useState(false);
  const [portalError, setPortalError] = useState("");
  const handledRef = useRef(false);

  // Back from Stripe: re-read the subscription until the upgrade shows up.
  useEffect(() => {
    if (handledRef.current) return undefined;
    if (checkoutResult === "cancelled") {
      handledRef.current = true;
      onClearParams?.();
      return undefined;
    }
    if (checkoutResult !== "success" && !portalReturned) return undefined;
    handledRef.current = true;
    onClearParams?.();

    let cancelled = false;
    let timer;
    let tries = 0;
    const wantPaid = checkoutResult === "success";

    function attempt() {
      tries += 1;
      syncMyBilling()
        .then((fresh) => {
          if (cancelled) return;
          plan.setData(fresh);
          if (!wantPaid) return;
          if (PAID_PLANS.includes(fresh?.plan)) setConfirming("done");
          else if (tries < SYNC_TRIES) timer = setTimeout(attempt, SYNC_EVERY_MS);
          else setConfirming("slow");
        })
        .catch(() => {
          if (cancelled) return;
          if (wantPaid && tries < SYNC_TRIES) timer = setTimeout(attempt, SYNC_EVERY_MS);
          else if (wantPaid) setConfirming("slow");
        });
    }
    attempt();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Arrived from the landing page's "Choose Pro": open that plan's
  // confirmation once prices are known — unless already on a paid plan.
  const openedRef = useRef(false);
  useEffect(() => {
    if (openedRef.current || !requestedPlan || !catalog || plan.status === "loading") return;
    openedRef.current = true;
    onClearParams?.();
    if (PAID_PLANS.includes(requestedPlan) && !onPaidPlan && catalog.prices?.[requestedPlan]?.[interval]) {
      setCheckout({ plan: requestedPlan });
    }
  }, [requestedPlan, catalog, plan.status, onPaidPlan, interval, onClearParams]);

  async function manageBilling() {
    setPortalBusy(true);
    setPortalError("");
    try {
      const { url } = await openBillingPortal();
      if (!url || !/^https:\/\//.test(url)) throw new Error("The billing portal couldn't be opened.");
      window.location.assign(url);
    } catch (err) {
      setPortalError(err.message);
      setPortalBusy(false);
    }
  }

  const billingOn = Boolean(data?.enabled);
  const hasBillingAccount = Boolean(sub?.hasBillingAccount);

  function renderAction(id, { price }) {
    if (!billingOn) {
      return id === current || (id === "regular" && !current) ? (
        <button type="button" className="btn-ghost" disabled>
          Your plan
        </button>
      ) : null;
    }
    if (id === current) {
      return onPaidPlan ? (
        <button type="button" className="btn-ghost" onClick={manageBilling} disabled={portalBusy}>
          Manage billing
        </button>
      ) : (
        <button type="button" className="btn-ghost" disabled>
          Your plan
        </button>
      );
    }
    if (id === "regular") {
      return onPaidPlan ? (
        <span className={styles.actionNote}>Cancel in Manage billing to move back to Regular.</span>
      ) : null;
    }
    if (onPaidPlan) {
      return (
        <button type="button" className="btn-ghost" onClick={manageBilling} disabled={portalBusy}>
          Switch in Manage billing
        </button>
      );
    }
    return (
      <button
        type="button"
        className={id === "pro" ? "btn-primary" : "btn-ghost"}
        onClick={() => setCheckout({ plan: id })}
        disabled={!price}
      >
        Choose {planName(id)}
        <Icon name="chevronRight" />
      </button>
    );
  }

  return (
    <div className={styles.wrap}>
      <header className="page-head">
        <div>
          <h1>Plans</h1>
          <p className="page-sub">Your plan, what you've used today, and billing.</p>
        </div>
        {hasBillingAccount && (
          <button type="button" className="btn-ghost" onClick={manageBilling} disabled={portalBusy}>
            <Icon name={portalBusy ? "loader" : "externalLink"} />
            {portalBusy ? "Opening…" : "Manage billing"}
          </button>
        )}
      </header>

      {confirming === "waiting" && (
        <div className="info-banner" role="status">
          <Icon name="loader" />
          <span>Payment received. Confirming your subscription with Stripe…</span>
        </div>
      )}
      {confirming === "done" && (
        <div className="info-banner" role="status">
          <Icon name="check" />
          <span>
            You're on {planName(current)}. Thank you! A receipt is on its way to your email.
          </span>
        </div>
      )}
      {confirming === "slow" && (
        <div className="warn-banner" role="status">
          <Icon name="clock" />
          <span>
            Stripe hasn't confirmed the subscription yet. It usually takes a few seconds; reload this
            page in a minute. If your plan still hasn't changed and you were charged, email us and
            we'll sort it out.
          </span>
        </div>
      )}
      {notice && (
        <div className="info-banner" role="status">
          <Icon name="alert" />
          <span>{notice}</span>
          <button type="button" className="btn-ghost" onClick={() => setNotice("")}>
            Dismiss
          </button>
        </div>
      )}
      {portalError && (
        <div className="error-banner" role="alert">
          <Icon name="alert" />
          <span>{portalError}</span>
        </div>
      )}
      {plan.status === "error" && (
        <div className="error-banner" role="alert">
          <Icon name="alert" />
          <span>Couldn't load your plan: {plan.error}</span>
          <button type="button" className="btn-ghost" onClick={plan.refresh}>
            Try again
          </button>
        </div>
      )}

      {plan.status === "loading" && <div className={`skeleton ${styles.skelSummary}`} aria-hidden="true" />}

      {data && (
        <section className={styles.summary} aria-labelledby="current-plan">
          <div className={styles.summaryHead}>
            <div>
              <p className="eyebrow">Current plan</p>
              <h2 id="current-plan" className={styles.planTitle}>
                {data.enforced ? planName(current) : "Everything unlocked"}
              </h2>
              <p className={styles.status}>
                <StatusLine data={data} />
              </p>
            </div>
          </div>

          {sub?.status === "past_due" && (
            <div className="warn-banner" role="status">
              <Icon name="alert" />
              <span>
                Your last payment didn't go through. Stripe will retry it; update your card in Manage
                billing to keep {planName(current)}.
              </span>
            </div>
          )}

          {data.enforced && (
            <dl className={styles.usage}>
              {USAGE_ROWS.map(({ kind, label }) => {
                const u = data.usage?.[kind];
                if (!u) return null;
                const pct = u.limit ? Math.min(100, Math.round((u.used / u.limit) * 100)) : 0;
                return (
                  <div key={kind} className={styles.meter}>
                    <dt className={styles.meterLabel}>{label}</dt>
                    <dd className={styles.meterValue}>
                      <span className="mono">
                        {u.used}
                        {u.limit != null ? ` / ${u.limit}` : ""}
                      </span>
                      {u.limit != null && (
                        <span
                          className={styles.bar}
                          role="meter"
                          aria-valuemin={0}
                          aria-valuemax={u.limit}
                          aria-valuenow={u.used}
                          aria-label={`${label} used today`}
                        >
                          <span
                            className={`${styles.fill} ${u.used >= u.limit ? styles.full : ""}`}
                            style={{ width: `${pct}%` }}
                          />
                        </span>
                      )}
                    </dd>
                  </div>
                );
              })}
            </dl>
          )}
          {data.enforced && <p className={styles.reset}>{resetLabel(data.resetsAt)}</p>}
          {data.history?.hidden > 0 && (
            <p className={styles.reset}>
              {data.history.hidden} older interview{data.history.hidden === 1 ? " is" : "s are"} saved
              but hidden on {planName(current)}. Upgrading shows {data.history.hidden === 1 ? "it" : "them"}{" "}
              again.
            </p>
          )}
        </section>
      )}

      <section className={styles.plansSection} aria-labelledby="all-plans">
        <h2 id="all-plans" className={styles.sectionTitle}>
          {onPaidPlan ? "All plans" : "Upgrade"}
        </h2>
        {!billingOn && data && (
          <p className={styles.sectionSub}>
            Paid plans aren't on sale yet. Until they are, every feature is available to everyone.
          </p>
        )}
        <PlanComparison
          catalog={catalog}
          interval={interval}
          onIntervalChange={setInterval_}
          renderAction={renderAction}
          currentPlan={data?.enforced ? current : null}
        />
      </section>

      {checkout && catalog && (
        <CheckoutDialog
          plan={checkout.plan}
          interval={interval}
          price={catalog.prices?.[checkout.plan]?.[interval] ?? null}
          automaticTax={Boolean(catalog.automaticTax)}
          onClose={() => setCheckout(null)}
        />
      )}
    </div>
  );
}

function StatusLine({ data }) {
  const sub = data.subscription;
  const name = planName(data.plan);
  if (!data.enforced) return "Paid plans aren't switched on, so nothing is limited.";
  if (data.source === "dev") return `Testing ${name}'s limits (DEV_PLAN). No billing is involved.`;
  if (PAID_PLANS.includes(data.plan) && sub) {
    const period = sub.interval === "year" ? "yearly" : "monthly";
    if (sub.cancelAt) {
      return `Billed ${period}. Cancelled — you keep ${name} until ${formatDate(sub.cancelAt)}, then move to Regular.`;
    }
    if (sub.currentPeriodEnd) return `Billed ${period}. Renews on ${formatDate(sub.currentPeriodEnd)}.`;
    return `Billed ${period}.`;
  }
  if (sub?.status === "canceled" && sub.currentPeriodEnd) {
    return `Your subscription ended on ${formatDate(sub.currentPeriodEnd)}. Everything you saved is still here.`;
  }
  if (sub?.status === "incomplete" || sub?.status === "incomplete_expired") {
    return "Your last checkout wasn't completed, so you weren't upgraded.";
  }
  return "The free plan. Upgrade any time; cancel any time.";
}
