import { supabase } from "../auth/supabaseClient.js";
import { answersToRow, emptyAnswers, rowToAnswers } from "./surveyMapping.js";

/**
 * The only module that reads or writes `public.user_survey_responses`.
 *
 * It talks to Supabase directly rather than going through the Express API,
 * because the API has no notion of a user account (see CLAUDE.md → "Security
 * model"). Row-level security on the table is what scopes a row to its owner:
 * every policy is `auth.uid() = user_id`, so the access token the client
 * already holds is the whole authorization story. That also means the server
 * never sees these answers — which is the point. No AI prompt can reach them.
 *
 * Nothing here throws for the two states that aren't really errors:
 *   - the migration hasn't been applied → `{ available: false }`
 *   - the user has no row yet → `{ status: "none" }`
 * Both switch the feature off quietly instead of showing an error for
 * something the user can't act on.
 */

/**
 * PostgREST's codes for "that table isn't in the schema cache" and Postgres's
 * own "undefined_table". Either means the migration hasn't been run.
 */
const MISSING_TABLE_CODES = new Set(["PGRST205", "PGRST202", "42P01"]);

const TABLE = "user_survey_responses";

function isMissingTable(error) {
  if (!error) return false;
  if (MISSING_TABLE_CODES.has(error.code)) return true;
  const msg = (error.message || "").toLowerCase();
  return msg.includes("does not exist") && msg.includes(TABLE);
}

/**
 * Read this user's row.
 *
 * Resolves `{ available, status, answers, completedAt }` where `status` is
 * "none" | "dismissed" | "completed", and never rejects for a missing table.
 * It does reject for a real failure (offline, RLS misconfigured) so the caller
 * can decide — `useSurvey` treats that as "unavailable" too, since a survey
 * prompt is not worth an error banner on the dashboard.
 */
export async function fetchSurvey(userId) {
  if (!supabase || !userId) return { available: false, status: "none", answers: emptyAnswers() };

  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    if (isMissingTable(error)) {
      return { available: false, status: "none", answers: emptyAnswers() };
    }
    throw new Error(error.message || "Could not load your survey answers.");
  }

  return {
    available: true,
    status: data?.status === "completed" ? "completed" : data ? "dismissed" : "none",
    answers: rowToAnswers(data),
    completedAt: data?.completed_at ?? null,
  };
}

/**
 * Write this user's row, creating it if it isn't there.
 *
 * `status` is "dismissed" (skipped the banner, or exited partway with whatever
 * was filled in) or "completed" (pressed Submit). Either way the banner stops
 * appearing, because the banner keys on the row existing at all.
 *
 * `completed_at` is set on completion and deliberately *not* cleared by a later
 * partial save — once someone has finished the survey they have finished it,
 * even if they later reopen it and exit halfway through editing.
 */
export async function saveSurvey(userId, answers, status = "completed") {
  if (!supabase) throw new Error("Sign-in isn't configured.");
  if (!userId) throw new Error("You need to be signed in to save your answers.");

  const row = {
    user_id: userId,
    status: status === "completed" ? "completed" : "dismissed",
    ...answersToRow(answers || emptyAnswers()),
  };
  if (status === "completed") row.completed_at = new Date().toISOString();

  const { error } = await supabase.from(TABLE).upsert(row, { onConflict: "user_id" });

  if (error) {
    if (isMissingTable(error)) {
      throw new Error(
        "The survey table hasn't been created yet. Apply supabase/migrations/ to your project and try again."
      );
    }
    throw new Error(error.message || "Could not save your answers.");
  }
}

/**
 * Record "skip for now" without opening the form: an empty row with status
 * 'dismissed', which is what stops the banner coming back next session.
 */
export async function dismissSurvey(userId) {
  return saveSurvey(userId, emptyAnswers(), "dismissed");
}
