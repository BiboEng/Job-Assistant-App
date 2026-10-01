import { PLAN_RANK, isPaidPlan } from "../plans.js";

/**
 * Pure: a Stripe customer's subscriptions → the plan they're entitled to right
 * now, and the subscription details the Plans page shows.
 *
 * Kept free of the Stripe SDK so it can be unit tested with plain objects.
 */

// Statuses that keep paid access. `past_due` is included on purpose: Stripe
// retries a failed renewal for a while (Settings → Billing → Retries), and
// cutting someone off at the first declined card — often an expired card
// they're about to update — is harsher than the grace period Stripe gives.
// When retries run out Stripe cancels (or marks the subscription `unpaid`),
// the webhook fires, and access ends then.
export const ENTITLED_STATUSES = new Set(["active", "trialing", "past_due"]);

/**
 * Which plan a Stripe Price sells. Recognised two ways, so a price change
 * can't silently strip existing subscribers of their plan:
 *   1. the price id is listed in the env (each STRIPE_PRICE_* variable may
 *      hold several comma-separated ids — the first is the one sold, the rest
 *      are older prices still being paid);
 *   2. the Price carries metadata `jobassist_plan: "pro" | "ultimate"`.
 * @param {object} price  a Stripe Price
 * @param {Map<string, { plan: string, interval: string }>} knownPrices
 */
export function planForPrice(price, knownPrices) {
  if (!price) return null;
  const known = knownPrices.get(price.id);
  if (known) return known.plan;
  const tagged = price.metadata?.jobassist_plan;
  return isPaidPlan(tagged) ? tagged : null;
}

function iso(seconds) {
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : null;
}

/** The fields we store for one subscription. */
function describe(sub, knownPrices) {
  const items = sub?.items?.data ?? [];
  const item = items.find((it) => planForPrice(it.price, knownPrices)) ?? items[0] ?? null;
  const plan = item ? planForPrice(item.price, knownPrices) : null;
  // Since API 2025-03-31 the billing period lives on the subscription ITEM;
  // older payloads carried it on the subscription. Read either.
  const periodEnd = item?.current_period_end ?? sub?.current_period_end ?? null;
  const cancelAt = sub?.cancel_at ?? (sub?.cancel_at_period_end ? periodEnd : null);
  return {
    plan,
    status: typeof sub?.status === "string" ? sub.status : null,
    interval: item?.price?.recurring?.interval ?? null,
    subscriptionId: sub?.id ?? null,
    priceId: item?.price?.id ?? null,
    currentPeriodEnd: iso(periodEnd),
    cancelAt: iso(cancelAt),
    created: sub?.created ?? 0,
    periodEndRaw: periodEnd ?? 0,
  };
}

/**
 * @param {object[]} subscriptions  every subscription the customer has (any status)
 * @param {Map<string, { plan: string, interval: string }>} knownPrices
 * @returns {{ plan: "regular"|"pro"|"ultimate", status, interval, subscriptionId,
 *   priceId, currentPeriodEnd, cancelAt }}
 */
export function pickEntitlement(subscriptions, knownPrices) {
  const described = (subscriptions ?? []).map((s) => describe(s, knownPrices));

  // The best plan among subscriptions that currently grant access. Two at once
  // shouldn't happen (checkout refuses while one is live), but if it does the
  // customer gets the higher plan, not whichever event arrived last.
  const entitled = described
    .filter((d) => d.plan && ENTITLED_STATUSES.has(d.status))
    .sort(
      (a, b) =>
        PLAN_RANK[b.plan] - PLAN_RANK[a.plan] ||
        b.periodEndRaw - a.periodEndRaw ||
        b.created - a.created
    );

  const chosen = entitled[0];
  if (chosen) return strip({ ...chosen });

  // No access. Still report the newest subscription's state (canceled,
  // incomplete, unpaid…) so the Plans page can say what happened.
  const latest = [...described].sort((a, b) => b.created - a.created)[0];
  if (!latest) {
    return {
      plan: "regular",
      status: null,
      interval: null,
      subscriptionId: null,
      priceId: null,
      currentPeriodEnd: null,
      cancelAt: null,
    };
  }
  return strip({ ...latest, plan: "regular" });
}

function strip(d) {
  const { created, periodEndRaw, ...rest } = d; // eslint-disable-line no-unused-vars
  return rest;
}

/**
 * Parse the STRIPE_PRICE_* settings into the lookup `planForPrice` uses.
 * @param {{ pro: { month: string, year: string }, ultimate: { month: string, year: string } }} prices
 */
export function knownPriceMap(prices) {
  const map = new Map();
  for (const plan of ["pro", "ultimate"]) {
    for (const interval of ["month", "year"]) {
      for (const id of splitPriceIds(prices?.[plan]?.[interval])) {
        if (!map.has(id)) map.set(id, { plan, interval });
      }
    }
  }
  return map;
}

/** "price_a, price_b" → ["price_a", "price_b"] */
export function splitPriceIds(value) {
  return String(value || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^price_[A-Za-z0-9]+$/.test(s));
}

/** The price currently sold for a plan + interval (the first listed), or "". */
export function sellingPriceId(prices, plan, interval) {
  return splitPriceIds(prices?.[plan]?.[interval])[0] || "";
}
