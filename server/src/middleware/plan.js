import { config } from "../config.js";
import { quotaFor, quotaMessage } from "../plans.js";
import { resolvePlan } from "../services/plan.service.js";
import { setOwnerCallLimit } from "../services/modelBudget.js";
import { reserveUsage } from "../services/usage.service.js";

/**
 * Puts the caller's plan on the request as `req.plan` (see plan.service.js),
 * and applies the plan's model-call backstop to the rest of the request.
 * Must run after `authenticate`, which establishes who the caller is.
 */
export function attachPlan(req, _res, next) {
  resolvePlan(req.userId ?? null)
    .then(({ plan, row, source }) => {
      req.plan = plan;
      req.planSource = source;
      req.subscriptionRow = row;
      setOwnerCallLimit(callLimitFor(plan));
      next();
    })
    .catch(next);
}

/** The per-user daily model-call ceiling for a plan. */
export function callLimitFor(plan) {
  const { modelCallsPerUserPerDay, modelCallsPerUserPerDayExplicit } = config.limits;
  if (plan?.modelCallsPerDay == null) return modelCallsPerUserPerDay;
  if (modelCallsPerUserPerDayExplicit && modelCallsPerUserPerDay > 0) {
    return Math.min(plan.modelCallsPerDay, modelCallsPerUserPerDay);
  }
  return plan.modelCallsPerDay;
}

/**
 * 403 for a feature the caller's plan doesn't include. The body carries a
 * machine-readable `code` so the client can offer "See plans" next to the
 * message instead of showing it as a plain failure.
 */
export function denyFeature(res, { feature, requiredPlan, message }) {
  return res.status(403).json({ error: message, code: "plan_feature", feature, requiredPlan });
}

/**
 * Reserve one unit of a daily quota. Resolves the reservation (call `refund()`
 * if the work then fails), or null after writing a 429 when it's used up.
 */
export async function takeQuota(req, res, kind) {
  const plan = req.plan;
  const hold = await reserveUsage(req.clientId, kind, plan ? quotaFor(plan, kind) : null);
  if (hold.ok) return hold;
  res.status(429).json({
    error: quotaMessage(plan, kind),
    code: "plan_quota",
    kind,
    limit: hold.limit,
  });
  return null;
}
