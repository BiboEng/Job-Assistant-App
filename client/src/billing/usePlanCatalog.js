import { useEffect, useState } from "react";
import { getPlanCatalog } from "../api/billingApi.js";

/**
 * The public price list (GET /api/billing/plans), read from Stripe by the
 * server. Cached for the life of the tab — prices don't change mid-visit, and
 * the landing page and the Plans page both want it.
 *
 * Resolves to `{ enabled, prices, strongerEvaluator, automaticTax }`, or null
 * while loading. A failed request reads as "billing off", which renders the
 * paid cards as "Coming soon" rather than breaking the page.
 */
let cached = null;
let pending = null;

const OFF = { enabled: false, prices: { pro: null, ultimate: null }, strongerEvaluator: false, automaticTax: false };

export function usePlanCatalog() {
  const [catalog, setCatalog] = useState(cached);

  useEffect(() => {
    if (cached) return undefined;
    let alive = true;
    if (!pending) {
      pending = getPlanCatalog()
        .then((data) => {
          cached = data && typeof data === "object" ? { ...OFF, ...data } : OFF;
          return cached;
        })
        .catch(() => {
          pending = null; // try again on the next mount
          return OFF;
        });
    }
    pending.then((data) => {
      if (alive) setCatalog(data);
    });
    return () => {
      alive = false;
    };
  }, []);

  return catalog;
}
