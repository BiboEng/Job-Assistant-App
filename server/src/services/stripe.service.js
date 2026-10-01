import Stripe from "stripe";
import { config } from "../config.js";
import { PLANS, isPaidPlan } from "../plans.js";
import {
  knownPriceMap,
  pickEntitlement,
  sellingPriceId,
} from "./entitlement.js";
import {
  getSubscriptionRowByCustomer,
  upsertSubscriptionRow,
} from "./supabaseAdmin.js";
import { invalidatePlan } from "./plan.service.js";

/**
 * The only module that talks to Stripe.
 *
 * What it does, and the rules it keeps:
 *
 *  - Payment happens on Stripe's hosted Checkout page. Card details never
 *    touch this server or the browser app (PCI scope stays at SAQ A), and
 *    Stripe handles 3-D Secure / Strong Customer Authentication.
 *  - Access is granted ONLY from Stripe's own record of the subscription, read
 *    fresh from the Stripe API when a signed webhook arrives (or when the user
 *    asks to re-check after checkout). Never from the success-page redirect,
 *    and never from anything the browser sends. Re-reading instead of
 *    trusting the event payload also makes duplicate and out-of-order events
 *    harmless.
 *  - Every Stripe customer is created here, for exactly one Supabase user, and
 *    the mapping lives in `user_subscriptions`. Events are resolved customer →
 *    user through that table; the customer's `metadata.user_id` is only a
 *    fallback.
 *  - Checkout requires ticking agreement to the Terms of Service, and states
 *    the renewal terms next to the Pay button.
 *  - Cancelling, changing plan and updating the card happen in Stripe's
 *    Customer Portal — as easy as subscribing, which auto-renewal laws require.
 */

let client = null;
let override = null;

function stripe() {
  if (override) return override;
  if (!client) {
    client = new Stripe(config.billing.stripeKey, {
      maxNetworkRetries: 2,
      timeout: 20_000,
      appInfo: { name: "Jobassist" },
    });
  }
  return client;
}

/** Test hook: use a fake Stripe client. */
export function _setStripeClient(fake) {
  override = fake || null;
}

// A fixed label for this checkout flow (Stripe Dashboard groups sessions by
// it). The random suffix only makes it unique to this integration.
const INTEGRATION_IDENTIFIER = "jobassist-plans-qmvtkzra";

const INTERVALS = ["month", "year"];

function billingError(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  err.expose = true;
  return err;
}

/* --- prices -------------------------------------------------------------- */

const PRICE_TTL_MS = 10 * 60 * 1000;
let priceCache = { at: 0, value: null, pending: null };

/**
 * The prices on sale, read from Stripe itself so the amount shown on the site
 * is always the amount Checkout charges. A configured id that points at an
 * inactive price, a one-off price, or a price with the wrong billing interval
 * is dropped (and logged) rather than shown.
 * @returns {Promise<Record<"pro"|"ultimate", Record<"month"|"year",
 *   { amount: number, currency: string, taxBehavior: string|null } | null>>>}
 */
export async function planPrices() {
  if (priceCache.value && Date.now() - priceCache.at < PRICE_TTL_MS) return priceCache.value;
  if (priceCache.pending) return priceCache.pending;

  priceCache.pending = (async () => {
    const out = {};
    for (const plan of ["pro", "ultimate"]) {
      out[plan] = {};
      for (const interval of INTERVALS) {
        const id = sellingPriceId(config.billing.prices, plan, interval);
        out[plan][interval] = id ? await readPrice(id, plan, interval) : null;
      }
    }
    priceCache = { at: Date.now(), value: out, pending: null };
    return out;
  })().catch((err) => {
    priceCache.pending = null;
    throw err;
  });
  return priceCache.pending;
}

async function readPrice(id, plan, interval) {
  try {
    const price = await stripe().prices.retrieve(id);
    const problem = !price.active
      ? "is archived"
      : price.type !== "recurring"
        ? "isn't a recurring price"
        : price.recurring?.interval !== interval || (price.recurring?.interval_count ?? 1) !== 1
          ? `isn't billed every 1 ${interval}`
          : !Number.isInteger(price.unit_amount)
            ? "has no fixed amount"
            : null;
    if (problem) {
      console.error(`[billing] The ${plan} ${interval}ly price (${id}) ${problem}; it won't be offered.`);
      return null;
    }
    return {
      amount: price.unit_amount,
      currency: String(price.currency || "").toUpperCase(),
      taxBehavior: price.tax_behavior ?? null,
    };
  } catch (err) {
    console.error(`[billing] Could not read the ${plan} ${interval}ly price (${id}):`, err.message);
    return null;
  }
}

export function _resetPriceCache() {
  priceCache = { at: 0, value: null, pending: null };
}

/* --- customers ----------------------------------------------------------- */

/**
 * The Stripe customer for a user, creating it (and recording the mapping) the
 * first time. The idempotency key makes a double click, or a retry after the
 * database write failed, return the same customer rather than a second one.
 */
async function ensureCustomer(userId, email, row) {
  if (row?.stripe_customer_id) {
    try {
      const existing = await stripe().customers.retrieve(row.stripe_customer_id);
      if (existing && !existing.deleted) return existing.id;
    } catch (err) {
      if (err?.code !== "resource_missing") throw err;
    }
  }

  const customer = await stripe().customers.create(
    {
      ...(email ? { email } : {}),
      metadata: { user_id: userId },
    },
    { idempotencyKey: `jobassist-customer-${userId}${row?.stripe_customer_id ? "-renew" : ""}` }
  );
  await upsertSubscriptionRow({ user_id: userId, stripe_customer_id: customer.id });
  invalidatePlan(userId);
  return customer.id;
}

/* --- checkout ------------------------------------------------------------ */

/**
 * Start a subscription checkout. Refuses while the user already has paid
 * access — switching between Pro and Ultimate happens in the Customer Portal,
 * which prorates instead of stacking a second subscription on the first.
 * @returns {Promise<string>} the Checkout URL to send the browser to
 */
export async function createCheckoutSession({ userId, email, plan, interval, row }) {
  if (!isPaidPlan(plan)) throw billingError("Pick Pro or Ultimate.");
  if (!INTERVALS.includes(interval)) throw billingError("Pick monthly or yearly billing.");
  const priceId = sellingPriceId(config.billing.prices, plan, interval);
  if (!priceId) {
    throw billingError(`${PLANS[plan].name} isn't available with ${interval}ly billing.`);
  }
  if (isPaidPlan(row?.plan)) {
    throw billingError(
      `You're already on ${PLANS[row.plan].name}. Use "Manage billing" to switch plans or billing period.`,
      409
    );
  }
  // The price must still be on sale (not archived, right interval) — the same
  // check that decides whether the site shows it.
  const prices = await planPrices();
  if (!prices[plan]?.[interval]) {
    throw billingError(`${PLANS[plan].name} can't be bought right now. Please try again later.`, 503);
  }

  const customer = await ensureCustomer(userId, email, row);
  const appUrl = config.billing.appUrl;
  const period = interval === "year" ? "year" : "month";

  const params = {
    mode: "subscription",
    customer,
    client_reference_id: userId,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${appUrl}/plans?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl}/plans?checkout=cancelled`,
    metadata: { user_id: userId, plan },
    subscription_data: { metadata: { user_id: userId, plan } },
    // The buyer must tick agreement to the Terms. Needs a Terms of Service URL
    // set in Stripe → Settings → Business → Public details (see BILLING.md).
    consent_collection: { terms_of_service: "required" },
    custom_text: {
      terms_of_service_acceptance: {
        message: `I agree to the [Terms of Service](${appUrl}/terms) and have read the [Refund & Cancellation Policy](${appUrl}/refunds).`,
      },
      submit: {
        message: `Your subscription renews automatically every ${period} at this price until you cancel. Cancel any time in Jobassist under Plans → Manage billing; you keep ${PLANS[plan].name} until the end of the period you've paid for.`,
      },
    },
    integration_identifier: INTEGRATION_IDENTIFIER,
  };

  if (config.billing.automaticTax) {
    // Tax on the address entered at checkout, which Canada needs in full (a
    // country alone doesn't identify the province, and GST/HST/QST differ by
    // province). customer_update saves it onto the Customer for renewals.
    params.automatic_tax = { enabled: true };
    params.billing_address_collection = "required";
    params.customer_update = { address: "auto", name: "auto" };
  }

  let session;
  try {
    session = await stripe().checkout.sessions.create(params);
  } catch (err) {
    console.error("[billing] checkout session failed:", err?.message);
    if (/terms of service/i.test(err?.message || "")) {
      console.error(
        "[billing] Set a Terms of Service URL in Stripe → Settings → Business → Public details."
      );
    }
    throw billingError("Checkout couldn't be started. Please try again in a moment.", 502);
  }
  if (!session?.url) throw billingError("Checkout couldn't be started.", 502);
  return session.url;
}

/** A Customer Portal link for managing an existing subscription. */
export async function createPortalSession({ row }) {
  if (!row?.stripe_customer_id) {
    throw billingError("There's no billing account to manage yet — you haven't subscribed.", 404);
  }
  try {
    const session = await stripe().billingPortal.sessions.create({
      customer: row.stripe_customer_id,
      return_url: `${config.billing.appUrl}/plans?portal=returned`,
    });
    return session.url;
  } catch (err) {
    console.error("[billing] portal session failed:", err?.message);
    throw billingError("The billing portal couldn't be opened. Please try again in a moment.", 502);
  }
}

/* --- keeping user_subscriptions in step with Stripe ---------------------- */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const syncing = new Map(); // customerId → Promise (one sync per customer at a time)

/**
 * Re-read a customer's subscriptions from Stripe and store the plan they're
 * entitled to. Order-independent and idempotent: however many events arrive,
 * in whatever order, the row ends up matching Stripe.
 * @returns {Promise<{ userId: string, plan: string } | null>} null for a
 *   customer this app didn't create
 */
export function syncCustomer(customerId) {
  const running = syncing.get(customerId);
  const run = (running || Promise.resolve())
    .catch(() => {})
    .then(() => doSync(customerId))
    .finally(() => {
      if (syncing.get(customerId) === run) syncing.delete(customerId);
    });
  syncing.set(customerId, run);
  return run;
}

async function doSync(customerId) {
  let userId = (await getSubscriptionRowByCustomer(customerId))?.user_id ?? null;
  if (!userId) {
    // Fallback only: the row write after customer creation may have failed.
    const customer = await stripe().customers.retrieve(customerId);
    const tagged = customer && !customer.deleted ? customer.metadata?.user_id : null;
    userId = UUID.test(String(tagged || "")) ? tagged : null;
  }
  if (!userId) {
    console.warn(`[billing] ignoring an event for customer ${customerId}, which no user owns`);
    return null;
  }

  const subscriptions = [];
  let startingAfter;
  for (let page = 0; page < 5; page += 1) {
    let res;
    try {
      res = await stripe().subscriptions.list({
        customer: customerId,
        status: "all",
        limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });
    } catch (err) {
      // A deleted customer has no subscriptions left (deleting one cancels
      // them all), so it's simply back to Regular.
      if (err?.code === "resource_missing") break;
      throw err;
    }
    subscriptions.push(...(res?.data ?? []));
    if (!res?.has_more || !res.data?.length) break;
    startingAfter = res.data[res.data.length - 1].id;
  }

  const e = pickEntitlement(subscriptions, knownPriceMap(config.billing.prices));
  await upsertSubscriptionRow({
    user_id: userId,
    stripe_customer_id: customerId,
    plan: e.plan,
    status: e.status,
    billing_interval: e.interval,
    stripe_subscription_id: e.subscriptionId,
    stripe_price_id: e.priceId,
    current_period_end: e.currentPeriodEnd,
    cancel_at: e.cancelAt,
  });
  invalidatePlan(userId);
  return { userId, plan: e.plan };
}

// The events that can change what a customer is entitled to. Each one is
// handled the same way — re-sync the customer from Stripe — so none of them
// can be half-handled.
export const HANDLED_EVENTS = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
  "customer.subscription.trial_will_end",
  "invoice.paid",
  "invoice.payment_failed",
  "invoice.payment_action_required",
  "customer.deleted",
]);

/** Verify a webhook's signature and parse it. Throws on a bad signature. */
export function constructWebhookEvent(rawBody, signature) {
  return stripe().webhooks.constructEvent(rawBody, signature, config.billing.webhookSecret);
}

/**
 * Handle one verified event. Unhandled types are acknowledged and ignored.
 * @returns {Promise<{ handled: boolean }>}
 */
export async function handleStripeEvent(event) {
  if (!HANDLED_EVENTS.has(event?.type)) return { handled: false };
  const obj = event.data?.object ?? {};
  const customerId =
    event.type === "customer.deleted"
      ? obj.id
      : typeof obj.customer === "string"
        ? obj.customer
        : obj.customer?.id;
  if (!customerId) return { handled: false };
  await syncCustomer(customerId);
  return { handled: true };
}
