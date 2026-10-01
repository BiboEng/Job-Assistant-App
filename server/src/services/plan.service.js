import { billingStatus, config } from "../config.js";
import { PLANS, PLAN_IDS, UNLIMITED_PLAN, planById } from "../plans.js";
import { getSubscriptionRow } from "./supabaseAdmin.js";

/**
 * Which plan a request runs under.
 *
 *   billing ON   → the plan recorded in `user_subscriptions` for the VERIFIED
 *                  Supabase user (no row = Regular). That row is written only
 *                  by the Stripe webhook handler, from Stripe's own record of
 *                  the subscription — never from anything a browser says.
 *   billing OFF  → no limits (the app as it was before plans), unless
 *                  DEV_PLAN names a plan to try out locally.
 *
 * Plans are cached per user for `planCacheMs`; the webhook handler clears a
 * user's entry the moment their subscription changes. If Supabase can't be
 * read, the last known plan is used, and failing that Regular — a paying user
 * briefly getting Regular limits during an outage is recoverable; a free user
 * getting Ultimate because the lookup failed open is not.
 */

const cache = new Map(); // userId → { plan, row, at }

export function billingEnabled() {
  return billingStatus().enabled;
}

/** True when plan limits apply at all (billing on, or a DEV_PLAN to test with). */
export function plansEnforced() {
  return billingEnabled() || PLAN_IDS.includes(config.billing.devPlan);
}

/**
 * @param {string|null} userId  the verified Supabase user id (`sub`)
 * @returns {Promise<{ plan: object, row: object|null, source: "billing"|"dev"|"off" }>}
 */
export async function resolvePlan(userId) {
  if (!billingEnabled()) {
    const dev = config.billing.devPlan;
    if (PLAN_IDS.includes(dev)) return { plan: PLANS[dev], row: null, source: "dev" };
    return { plan: UNLIMITED_PLAN, row: null, source: "off" };
  }

  // Billing is on, which requires verified sign-ins — so a request with no
  // verified user is anonymous and gets the free plan.
  if (!userId) return { plan: PLANS.regular, row: null, source: "billing" };

  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < config.billing.planCacheMs) {
    return { plan: hit.plan, row: hit.row, source: "billing" };
  }

  try {
    const row = await getSubscriptionRow(userId);
    const plan = planById(row?.plan);
    cache.set(userId, { plan, row, at: Date.now() });
    return { plan, row, source: "billing" };
  } catch (err) {
    console.error("[billing] could not read plan for a user:", err.message);
    if (hit) return { plan: hit.plan, row: hit.row, source: "billing" };
    return { plan: PLANS.regular, row: null, source: "billing" };
  }
}

/** Forget a user's cached plan (the webhook calls this after every change). */
export function invalidatePlan(userId) {
  if (userId) cache.delete(userId);
}

export function _resetPlanCache() {
  cache.clear();
}
