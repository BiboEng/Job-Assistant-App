import { config } from "../config.js";
import { USAGE_KINDS, quotaFor } from "../plans.js";
import { billingEnabled, plansEnforced, resolvePlan } from "../services/plan.service.js";
import { getSubscriptionRow } from "../services/supabaseAdmin.js";
import {
  constructWebhookEvent,
  createCheckoutSession,
  createPortalSession,
  handleStripeEvent,
  planPrices,
  syncCustomer,
} from "../services/stripe.service.js";
import { resetsAt, usageFor } from "../services/usage.service.js";
import { countInterviews } from "../services/history.service.js";

/**
 * Plans & billing.
 *
 *   GET  /api/billing/plans     public — which paid prices are on sale
 *   GET  /api/billing/me        the caller's plan, subscription and today's usage
 *   POST /api/billing/checkout  { plan, interval } → { url } (Stripe Checkout)
 *   POST /api/billing/portal    → { url } (Stripe Customer Portal)
 *   POST /api/billing/sync      re-read the caller's subscription from Stripe
 *   POST /api/billing/webhook   Stripe → us, signature-verified, raw body
 */

function unavailable(res) {
  return res.status(503).json({ error: "Paid plans aren't available right now." });
}

/**
 * GET /api/billing/plans
 * `strongerEvaluator` says whether Ultimate's stronger feedback model is
 * actually configured, and `automaticTax` whether tax is added at checkout —
 * so the pricing page never advertises either when it isn't true.
 */
export async function getPlanCatalog(_req, res, next) {
  try {
    const features = {
      strongerEvaluator: Boolean(config.billing.ultimateEvaluatorModel),
      automaticTax: config.billing.automaticTax,
    };
    if (!billingEnabled()) {
      return res
        .status(200)
        .json({ enabled: false, prices: { pro: null, ultimate: null }, ...features });
    }
    let prices;
    try {
      prices = await planPrices();
    } catch (err) {
      console.error("[billing] could not load prices:", err.message);
      prices = { pro: null, ultimate: null };
    }
    return res.status(200).json({ enabled: true, prices, ...features });
  } catch (err) {
    next(err);
  }
}

/** The plan summary the client renders the Plans page and every lock from. */
async function summary(req, { plan, row, source }) {
  const used = await usageFor(req.clientId);
  const usage = Object.fromEntries(
    USAGE_KINDS.map((kind) => [kind, { used: used[kind], limit: quotaFor(plan, kind) }])
  );
  const total = await countInterviews(req.clientId);
  const visible = plan.historyVisible == null ? total : Math.min(total, plan.historyVisible);
  return {
    enabled: billingEnabled(),
    enforced: plansEnforced(),
    source,
    plan: plan.id,
    limits: {
      maxQuestions: plan.maxQuestions,
      focuses: plan.focuses,
      speakMode: plan.speakMode,
      exports: plan.exports,
      progressInsights: plan.progressInsights,
      trackerCards: plan.trackerCards,
      historyVisible: plan.historyVisible,
      // True only when a stronger model is actually configured.
      strongerEvaluator: plan.strongerEvaluator && Boolean(config.billing.ultimateEvaluatorModel),
    },
    usage,
    resetsAt: resetsAt(),
    history: { total, visible, hidden: total - visible },
    subscription: row
      ? {
          status: row.status ?? null,
          interval: row.billing_interval ?? null,
          currentPeriodEnd: row.current_period_end ?? null,
          cancelAt: row.cancel_at ?? null,
          hasBillingAccount: Boolean(row.stripe_customer_id),
        }
      : null,
  };
}

/** GET /api/billing/me */
export async function getMyBilling(req, res, next) {
  try {
    res.status(200).json(
      await summary(req, { plan: req.plan, row: req.subscriptionRow ?? null, source: req.planSource })
    );
  } catch (err) {
    next(err);
  }
}

/** POST /api/billing/checkout   body: { plan: "pro"|"ultimate", interval: "month"|"year" } */
export async function startCheckout(req, res, next) {
  try {
    if (!billingEnabled()) return unavailable(res);
    if (!req.userId) return res.status(401).json({ error: "Sign in to continue." });

    const { plan, interval = "month" } = req.body ?? {};
    // Read the row fresh (not the plan cache) so a subscription that became
    // active seconds ago isn't bought twice.
    const row = await getSubscriptionRow(req.userId);
    const url = await createCheckoutSession({
      userId: req.userId,
      email: req.userEmail,
      plan,
      interval,
      row,
    });
    res.status(200).json({ url });
  } catch (err) {
    next(err);
  }
}

/** POST /api/billing/portal */
export async function openPortal(req, res, next) {
  try {
    if (!billingEnabled()) return unavailable(res);
    if (!req.userId) return res.status(401).json({ error: "Sign in to continue." });
    const row = await getSubscriptionRow(req.userId);
    res.status(200).json({ url: await createPortalSession({ row }) });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/billing/sync
 * The return from Checkout can beat the webhook. This lets the Plans page ask
 * for the caller's OWN subscription to be re-read from Stripe — Stripe stays
 * the source of truth; the browser only chooses when to look.
 */
export async function syncMine(req, res, next) {
  try {
    if (!billingEnabled()) return unavailable(res);
    if (!req.userId) return res.status(401).json({ error: "Sign in to continue." });
    const row = await getSubscriptionRow(req.userId);
    if (row?.stripe_customer_id) await syncCustomer(row.stripe_customer_id);
    const resolved = await resolvePlan(req.userId);
    res.status(200).json(await summary(req, resolved));
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/billing/webhook — mounted with express.raw, before express.json,
 * because the signature is over the exact bytes Stripe sent.
 *
 * 400 for a bad signature (Stripe won't retry that; nobody else should be
 * posting here). 500 when handling fails, so Stripe retries with backoff for
 * up to three days. 200 for everything else, including event types we ignore.
 */
export async function stripeWebhook(req, res) {
  if (!billingEnabled()) return res.status(503).json({ error: "Billing isn't configured." });

  const signature = req.get("stripe-signature");
  if (!signature || !Buffer.isBuffer(req.body)) {
    return res.status(400).json({ error: "Missing signature." });
  }

  let event;
  try {
    event = constructWebhookEvent(req.body, signature);
  } catch (err) {
    console.warn("[billing] webhook signature check failed:", err.message);
    return res.status(400).json({ error: "Invalid signature." });
  }

  try {
    const { handled } = await handleStripeEvent(event);
    return res.status(200).json({ received: true, handled });
  } catch (err) {
    console.error(`[billing] handling ${event.type} (${event.id}) failed:`, err.message);
    return res.status(500).json({ error: "Webhook handling failed." });
  }
}

