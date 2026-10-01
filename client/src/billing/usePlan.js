import { useCallback, useEffect, useRef, useState } from "react";
import { getMyBilling } from "../api/billingApi.js";

/**
 * The signed-in user's plan, subscription and today's usage (GET
 * /api/billing/me), owned by AppWorkspace so every screen reads one copy.
 *
 * Until it has loaded — or if it can't load — `limits` is null and screens
 * lock nothing: the server enforces every limit regardless, so a missing
 * summary costs a friendlier message, never access.
 *
 * `refresh()` re-reads it; AppWorkspace calls it on every navigation, so the
 * "2 of 3 interviews left today" counts stay current as the user moves around.
 */
export function usePlan() {
  const [state, setState] = useState({ status: "loading", data: null, error: "" });
  const inFlight = useRef(null);

  const refresh = useCallback(() => {
    if (inFlight.current) return inFlight.current;
    const run = getMyBilling()
      .then((data) => {
        setState({ status: "ready", data, error: "" });
        return data;
      })
      .catch((err) => {
        setState((s) => ({ status: s.data ? "ready" : "error", data: s.data, error: err.message }));
        return null;
      })
      .finally(() => {
        inFlight.current = null;
      });
    inFlight.current = run;
    return run;
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  /** Replace the summary with one the caller already has (e.g. from /sync). */
  const setData = useCallback((data) => {
    if (data) setState({ status: "ready", data, error: "" });
  }, []);

  const data = state.data;
  return {
    status: state.status,
    error: state.error,
    data,
    // Only "enforced" summaries lock anything. With billing off (and no
    // DEV_PLAN) the server applies no limits, so neither does the UI.
    limits: data?.enforced ? data.limits : null,
    usage: data?.enforced ? data.usage : null,
    planId: data?.plan ?? null,
    refresh,
    setData,
  };
}

/** "2 of 3 left today" for one usage kind, or "" when it's unlimited/unknown. */
export function remainingLabel(usage, kind, noun) {
  const u = usage?.[kind];
  if (!u || u.limit == null) return "";
  const left = Math.max(0, u.limit - u.used);
  return `${left} of ${u.limit} ${noun} left today`;
}

/** True when a daily allowance is known and used up. */
export function isExhausted(usage, kind) {
  const u = usage?.[kind];
  return Boolean(u && u.limit != null && u.used >= u.limit);
}
