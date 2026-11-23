import * as fileStore from "./history.file.js";
import * as supabaseStore from "./history.supabase.js";
import { supabaseAdminConfigured } from "./supabaseAdmin.js";

/**
 * Completed-interview history. Controllers and Progress import from here; the
 * records live in one of two stores with identical signatures:
 *
 *   supabase  public.interview_history, via the service-role key. Survives
 *             deploys and restarts. Used whenever SUPABASE_URL and
 *             SUPABASE_SERVICE_ROLE_KEY are both set.
 *   file      <DATA_DIR>/interviews.json. Local development and tests, or a
 *             server without the service-role key.
 *
 * HISTORY_STORE=file|supabase forces one. If the Supabase table doesn't exist
 * yet (migration not applied), the server falls back to the file and says so
 * in the log, rather than failing every history request.
 */

function chooseStore() {
  const forced = (process.env.HISTORY_STORE || "").trim().toLowerCase();
  if (forced === "file") return "file";
  if (forced === "supabase" || supabaseAdminConfigured()) return "supabase";
  return "file";
}

let storePromise = null;

function store() {
  if (!storePromise) storePromise = pickStore();
  return storePromise;
}

async function pickStore() {
  if (chooseStore() === "file") {
    await fileStore.ready();
    console.log("[history] storing interviews in the local file (DATA_DIR)");
    return fileStore;
  }
  try {
    await supabaseStore.ready();
    console.log("[history] storing interviews in Supabase (interview_history)");
  } catch (err) {
    if (err.missingTable) {
      console.error(
        "[history] the interview_history table doesn't exist. Apply " +
          "supabase/migrations/20261123120000_interview_history.sql. Until then, " +
          "history is kept in the local file and is lost on every redeploy."
      );
      await fileStore.ready();
      return fileStore;
    }
    // Anything else (a network blip on boot) isn't a reason to abandon the
    // database for the life of the process; requests will surface it.
    console.error("[history] couldn't reach Supabase on startup:", err.message);
  }
  return supabaseStore;
}

/** Called on boot so the store is chosen (and a problem logged) before the first request. */
export async function ensureHistoryReady() {
  await store();
}

export async function listInterviews(ownerId, opts) {
  return (await store()).listInterviews(ownerId, opts);
}

export async function countInterviews(ownerId) {
  return (await store()).countInterviews(ownerId);
}

export async function isWithinNewest(id, ownerId, limit) {
  return (await store()).isWithinNewest(id, ownerId, limit);
}

export async function getInterview(id, ownerId) {
  return (await store()).getInterview(id, ownerId);
}

export async function saveInterview(input) {
  return (await store()).saveInterview(input);
}

export async function deleteInterview(id, ownerId) {
  return (await store()).deleteInterview(id, ownerId);
}

export async function listOwnerRecords(ownerId) {
  return (await store()).listOwnerRecords(ownerId);
}

export async function setInterviewRoles(ownerId, rolesById) {
  return (await store()).setInterviewRoles(ownerId, rolesById);
}
