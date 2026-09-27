import { request } from "./client.js";
import { PROGRESS_REQUEST_TIMEOUT_MS } from "../constants.js";

/**
 * GET /api/progress — saved interviews grouped by role.
 * @returns {Promise<{ roles: Array<{ key, title, count, averageScore, bestScore,
 *   latestScore, change, latestAt, interviews: Array<{ id, createdAt,
 *   overallScore, jobTitle }> }>, labelling: boolean }>}
 */
export function getProgress() {
  return request("/progress", { timeoutMs: PROGRESS_REQUEST_TIMEOUT_MS });
}

/**
 * POST /api/progress/themes — recurring strengths/weaknesses for one role.
 * @param {string} roleKey
 * @param {{ signal?: AbortSignal }} [opts]
 * @returns {Promise<{ roleKey, interviewCount, totalCount, interviewIds,
 *   single: boolean, strengths: Theme[], weaknesses: Theme[] }>}
 *   where Theme = { theme: string, interviewIds: string[], count: number }
 */
export function getRoleThemes(roleKey, { signal } = {}) {
  return request("/progress/themes", {
    method: "POST",
    body: JSON.stringify({ roleKey }),
    timeoutMs: PROGRESS_REQUEST_TIMEOUT_MS,
    signal,
  });
}
