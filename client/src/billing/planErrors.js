/**
 * Plan-limit errors, from either side of the app:
 *   - the API: 403 `plan_feature` (not in your plan) or 429 `plan_quota`
 *     (today's allowance used), carried on the Error as `.code` by
 *     api/client.js;
 *   - Supabase: the Application Tracker's 15-card trigger, flagged
 *     `.planLimit` by applications/applicationsApi.js.
 * Screens use this to put "See plans" next to the message instead of treating
 * it as a failure to retry.
 */
export function isPlanError(err) {
  return Boolean(err && (err.code === "plan_feature" || err.code === "plan_quota" || err.planLimit));
}
