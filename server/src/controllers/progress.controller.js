import { getProgress, getRoleThemes } from "../services/progress.service.js";
import { denyFeature } from "../middleware/plan.js";

const MAX_ROLE_KEY_LENGTH = 200;

/**
 * GET /api/progress
 * The caller's saved interviews grouped by role, each group with its
 * chronological scores. Names any not-yet-labelled interviews first (best
 * effort — a model failure falls back to grouping by first line, never a 5xx).
 *
 * Covers the plan's visible history only; without Progress insights (Pro and
 * up) the per-interview rubric is left out and `insights: false` tells the
 * page to show those sections locked.
 */
export async function getProgressOverview(req, res, next) {
  try {
    res.status(200).json(
      await getProgress(req.clientId, {
        historyLimit: req.plan?.historyVisible ?? null,
        insights: req.plan?.progressInsights ?? true,
      })
    );
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/progress/themes   body: { roleKey }
 * Recurring strengths and weaknesses across one role's interviews. One model
 * call per distinct set of interviews, cached; none for a single interview.
 * A Pro feature: refused before any model call on plans without it.
 */
export async function getProgressThemes(req, res, next) {
  try {
    if (req.plan && !req.plan.progressInsights) {
      return denyFeature(res, {
        feature: "progressInsights",
        requiredPlan: "pro",
        message: "Recurring feedback is part of Pro. Upgrade to see what keeps coming up across your interviews.",
      });
    }

    const { roleKey } = req.body ?? {};
    if (typeof roleKey !== "string" || !roleKey.trim() || roleKey.length > MAX_ROLE_KEY_LENGTH) {
      return res.status(400).json({ error: "roleKey is required." });
    }
    if (!req.clientId) {
      return res.status(404).json({ error: "No interviews found for that role." });
    }

    const themes = await getRoleThemes(req.clientId, roleKey, {
      historyLimit: req.plan?.historyVisible ?? null,
    });
    if (!themes) return res.status(404).json({ error: "No interviews found for that role." });
    res.status(200).json(themes);
  } catch (err) {
    next(err);
  }
}
