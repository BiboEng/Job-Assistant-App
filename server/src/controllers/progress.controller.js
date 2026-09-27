import { getProgress, getRoleThemes } from "../services/progress.service.js";

const MAX_ROLE_KEY_LENGTH = 200;

/**
 * GET /api/progress
 * The caller's saved interviews grouped by role, each group with its
 * chronological scores. Names any not-yet-labelled interviews first (best
 * effort — a model failure falls back to grouping by first line, never a 5xx).
 */
export async function getProgressOverview(req, res, next) {
  try {
    res.status(200).json(await getProgress(req.clientId));
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/progress/themes   body: { roleKey }
 * Recurring strengths and weaknesses across one role's interviews. One model
 * call per distinct set of interviews, cached; none for a single interview.
 */
export async function getProgressThemes(req, res, next) {
  try {
    const { roleKey } = req.body ?? {};
    if (typeof roleKey !== "string" || !roleKey.trim() || roleKey.length > MAX_ROLE_KEY_LENGTH) {
      return res.status(400).json({ error: "roleKey is required." });
    }
    if (!req.clientId) {
      return res.status(404).json({ error: "No interviews found for that role." });
    }

    const themes = await getRoleThemes(req.clientId, roleKey);
    if (!themes) return res.status(404).json({ error: "No interviews found for that role." });
    res.status(200).json(themes);
  } catch (err) {
    next(err);
  }
}
