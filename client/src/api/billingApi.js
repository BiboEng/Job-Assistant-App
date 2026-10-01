import { request } from "./client.js";

/**
 * Plans & billing. Payment itself never happens here: checkout and the
 * billing portal are Stripe-hosted pages the browser is sent to.
 */

/** Public: which paid prices are on sale (read from Stripe), plus feature flags. */
export function getPlanCatalog() {
  return request("/billing/plans");
}

/** The signed-in user's plan, subscription and today's usage. */
export function getMyBilling() {
  return request("/billing/me");
}

/**
 * Re-read the caller's subscription from Stripe (used on the way back from
 * Checkout, which can arrive before Stripe's webhook does).
 */
export function syncMyBilling() {
  return request("/billing/sync", { method: "POST", body: JSON.stringify({}) });
}

/** @returns {Promise<{ url: string }>} the Stripe Checkout page to go to */
export function startCheckout(plan, interval) {
  return request("/billing/checkout", {
    method: "POST",
    body: JSON.stringify({ plan, interval }),
  });
}

/** @returns {Promise<{ url: string }>} the Stripe Customer Portal page to go to */
export function openBillingPortal() {
  return request("/billing/portal", { method: "POST", body: JSON.stringify({}) });
}
