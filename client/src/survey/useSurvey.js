import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../auth/AuthProvider.jsx";
import { fetchSurvey, dismissSurvey } from "./surveyApi.js";

/**
 * Whether this user has taken the onboarding survey, and the two writes that
 * change the answer.
 *
 * Owned by AppWorkspace and read from there by both the dashboard banner and
 * the account menu, so the row is fetched once per sign-in rather than once per
 * screen. `state` is one of:
 *
 *   "loading"      still asking
 *   "unavailable"  no Supabase, migration not applied, or the read failed —
 *                  the feature hides itself entirely
 *   "none"         no row: the only state that shows the banner
 *   "dismissed"    skipped, or exited partway. Reachable from the account menu.
 *   "completed"    submitted. Reachable from the account menu to edit.
 *
 * A failed read collapses to "unavailable" on purpose. Nobody came here to take
 * a survey, and an error banner on the dashboard about one is worse than the
 * prompt silently not appearing.
 */
export function useSurvey() {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const [state, setState] = useState("loading");

  const refresh = useCallback(() => {
    if (!userId) {
      setState("unavailable");
      return undefined;
    }
    let cancelled = false;
    setState("loading");
    fetchSurvey(userId)
      .then((result) => {
        if (cancelled) return;
        setState(result.available ? result.status : "unavailable");
      })
      .catch(() => {
        if (!cancelled) setState("unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  useEffect(() => refresh(), [refresh]);

  /** "Skip for now" — writes the dismissed row so the banner doesn't return. */
  const skip = useCallback(async () => {
    if (!userId) return;
    // Optimistic: the banner should go away on the click, not on the round
    // trip. If the write fails the state is corrected back, and the banner
    // reappears on the next load — which is the honest outcome, since nothing
    // was recorded.
    setState("dismissed");
    try {
      await dismissSurvey(userId);
    } catch {
      setState("none");
    }
  }, [userId]);

  /** Called by the survey screen after a successful save. */
  const markSaved = useCallback((status) => {
    setState(status === "completed" ? "completed" : "dismissed");
  }, []);

  return {
    state,
    available: state !== "loading" && state !== "unavailable",
    shouldPrompt: state === "none",
    completed: state === "completed",
    refresh,
    skip,
    markSaved,
  };
}
