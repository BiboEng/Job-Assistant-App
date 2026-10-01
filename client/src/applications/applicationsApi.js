import { supabase } from "../auth/supabaseClient.js";
import { applicationToRow, rowToApplication } from "./applicationModel.js";

/**
 * The only module that reads or writes `public.user_applications`.
 *
 * Like the survey, it talks to Supabase directly rather than through the
 * Express API, because the API has no notion of a user account (CLAUDE.md →
 * "Security model"). Row-level security is what scopes rows to their owner —
 * every policy is `auth.uid() = user_id` — so the access token the client
 * already holds is the whole authorization story, and the server never sees
 * any of it.
 *
 * A missing table (migration not applied) is not an error: reads resolve
 * `{ available: false }` and the UI switches the feature off.
 */

const TABLE = "user_applications";

const MISSING_TABLE_CODES = new Set(["PGRST205", "PGRST202", "42P01"]);
const UNIQUE_VIOLATION = "23505";

function isMissingTable(error) {
  if (!error) return false;
  if (MISSING_TABLE_CODES.has(error.code)) return true;
  const msg = (error.message || "").toLowerCase();
  return msg.includes("does not exist") && msg.includes(TABLE);
}

/** The plan-limit trigger in 20260930120000_user_subscriptions.sql. */
function isApplicationLimit(error) {
  return /application_limit_reached/.test(error?.message || "");
}

function fail(error, fallback) {
  if (isMissingTable(error)) {
    const err = new Error(
      "The applications table hasn't been created yet. Apply supabase/migrations/ to your project and try again."
    );
    err.missingTable = true;
    return err;
  }
  const err = new Error(error?.message || fallback);
  err.code = error?.code;
  return err;
}

function requireClient(userId) {
  if (!supabase) throw new Error("Sign-in isn't configured.");
  if (!userId) throw new Error("You need to be signed in to track applications.");
}

/** Every application this user has. Resolves `{ available, applications }`. */
export async function listApplications(userId) {
  if (!supabase || !userId) return { available: false, applications: [] };

  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (error) {
    if (isMissingTable(error)) return { available: false, applications: [] };
    throw fail(error, "Could not load your applications.");
  }
  return { available: true, applications: (data || []).map(rowToApplication) };
}

/**
 * Which Job Matches listings this user already tracks, as a Set of listing ids.
 * Resolves `{ available, ids }` — Job Matches hides "Track this" entirely when
 * the table isn't there.
 */
export async function listTrackedJobIds(userId) {
  if (!supabase || !userId) return { available: false, ids: new Set() };

  const { data, error } = await supabase
    .from(TABLE)
    .select("source_job_id")
    .eq("user_id", userId)
    .not("source_job_id", "is", null);

  if (error) {
    if (isMissingTable(error)) return { available: false, ids: new Set() };
    throw fail(error, "Could not check your tracked jobs.");
  }
  return { available: true, ids: new Set((data || []).map((r) => r.source_job_id)) };
}

/**
 * Create an application and resolve the stored row (with its id and dates).
 * A second "Track this" on a listing already tracked rejects with
 * `err.duplicate = true`, which the caller treats as success.
 */
export async function createApplication(userId, draft) {
  requireClient(userId);

  const { data, error } = await supabase
    .from(TABLE)
    .insert({ ...applicationToRow(draft), user_id: userId })
    .select("*")
    .single();

  if (error) {
    // Regular's 15-card cap, enforced by a trigger in Supabase (the tracker
    // never goes through the API server, so that's the only place it can be).
    if (isApplicationLimit(error)) {
      const err = new Error(
        "Regular can track up to 15 applications. Delete one to make room, or upgrade to Pro for unlimited."
      );
      err.planLimit = true;
      throw err;
    }
    const err = fail(error, "Could not add that application.");
    if (error.code === UNIQUE_VIOLATION) err.duplicate = true;
    throw err;
  }
  return rowToApplication(data);
}

/** Write a partial update and resolve the stored row. */
export async function updateApplication(userId, id, patch) {
  requireClient(userId);

  const { data, error } = await supabase
    .from(TABLE)
    .update(applicationToRow(patch))
    .eq("id", id)
    .eq("user_id", userId)
    .select("*")
    .maybeSingle();

  if (error) throw fail(error, "Could not save that change.");
  if (!data) throw new Error("That application no longer exists.");
  return rowToApplication(data);
}

export async function deleteApplication(userId, id) {
  requireClient(userId);

  const { error } = await supabase.from(TABLE).delete().eq("id", id).eq("user_id", userId);
  if (error) throw fail(error, "Could not delete that application.");
}
