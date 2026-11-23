import { config } from "../config.js";
import { supabaseRest } from "./supabaseAdmin.js";
import { buildRecord, recordToRow, rowToRecord, summarize } from "./historyRecord.js";

/**
 * The Supabase history store: `public.interview_history`
 * (supabase/migrations/20261123120000_interview_history.sql), read and written
 * with the service-role key. Same function signatures and record shape as
 * history.file.js; history.service.js picks between them.
 *
 * Every query filters on `owner_id`, which comes from the verified token, so
 * one account can't list, open, relabel or delete another's interviews — the
 * table's RLS (no policies) keeps the browser out entirely.
 */

const TABLE = "interview_history";

const OWNER = /^[A-Za-z0-9_-]{1,200}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The dashboard list needs the posting text (title + snippet), the score and
// which answers were given — not the feedback write-up.
const SUMMARY_COLUMNS =
  "id,owner_id,created_at,job_description,mode,total_questions,qa_pairs,feedback:feedback->overallScore";

function ownerFilter(ownerId) {
  return `owner_id=eq.${encodeURIComponent(ownerId)}`;
}

function rest(query, init) {
  return supabaseRest(TABLE, query, init);
}

/** Throws (with `missingTable`) if the table isn't there, so the caller can fall back. */
export async function ready() {
  await rest("?select=id&limit=1", { method: "GET" });
}

export async function listInterviews(ownerId, { limit = null } = {}) {
  if (!OWNER.test(String(ownerId || ""))) return [];
  const cap = limit == null ? "" : `&limit=${Math.max(0, Math.floor(limit))}`;
  if (limit != null && limit <= 0) return [];
  const rows = await rest(
    `?${ownerFilter(ownerId)}&select=${SUMMARY_COLUMNS}&order=created_at.desc${cap}`,
    { method: "GET" }
  );
  return (rows ?? []).map((row) => {
    // `feedback` was selected as just its overallScore; put it back where
    // summarize() looks for it.
    const record = rowToRecord({ ...row, feedback: { overallScore: row.feedback } });
    return summarize(record);
  });
}

export async function countInterviews(ownerId) {
  if (!OWNER.test(String(ownerId || ""))) return 0;
  const rows = await rest(`?${ownerFilter(ownerId)}&select=id`, { method: "GET" });
  return (rows ?? []).length;
}

export async function isWithinNewest(id, ownerId, limit) {
  if (limit == null) return true;
  if (limit <= 0 || !OWNER.test(String(ownerId || ""))) return false;
  const rows = await rest(
    `?${ownerFilter(ownerId)}&select=id&order=created_at.desc&limit=${Math.floor(limit)}`,
    { method: "GET" }
  );
  return (rows ?? []).some((row) => row.id === id);
}

export async function getInterview(id, ownerId) {
  if (!UUID.test(String(id || "")) || !OWNER.test(String(ownerId || ""))) return null;
  const rows = await rest(`?id=eq.${id}&${ownerFilter(ownerId)}&select=*`, { method: "GET" });
  return rows?.[0] ? rowToRecord(rows[0]) : null;
}

export async function saveInterview(input) {
  const record = buildRecord(input);
  await rest("", {
    method: "POST",
    prefer: "return=minimal",
    body: JSON.stringify(recordToRow(record)),
  });
  // The cap is housekeeping: a failure here mustn't turn a saved interview
  // into a failed save.
  enforceOwnerCap(record.ownerId).catch((err) =>
    console.error("[history] could not trim old interviews:", err.message)
  );
  return record;
}

/** Keep only the newest N records for an owner. */
async function enforceOwnerCap(ownerId) {
  const max = config.limits.maxInterviewsPerOwner;
  if (!OWNER.test(String(ownerId || "")) || max <= 0) return;
  const extra = await rest(
    `?${ownerFilter(ownerId)}&select=id&order=created_at.desc&offset=${max}`,
    { method: "GET" }
  );
  const ids = (extra ?? []).map((row) => row.id).filter((id) => UUID.test(id));
  if (!ids.length) return;
  await rest(`?${ownerFilter(ownerId)}&id=in.(${ids.join(",")})`, {
    method: "DELETE",
    prefer: "return=minimal",
  });
}

export async function deleteInterview(id, ownerId) {
  if (!UUID.test(String(id || "")) || !OWNER.test(String(ownerId || ""))) return false;
  const rows = await rest(`?id=eq.${id}&${ownerFilter(ownerId)}`, {
    method: "DELETE",
    prefer: "return=representation",
  });
  return Array.isArray(rows) && rows.length > 0;
}

export async function listOwnerRecords(ownerId) {
  if (!OWNER.test(String(ownerId || ""))) return [];
  const rows = await rest(`?${ownerFilter(ownerId)}&select=*&order=created_at.asc`, {
    method: "GET",
  });
  return (rows ?? []).map(rowToRecord);
}

export async function setInterviewRoles(ownerId, rolesById) {
  if (!OWNER.test(String(ownerId || "")) || !rolesById?.size) return 0;
  const results = await Promise.all(
    [...rolesById].map(async ([id, role]) => {
      if (!UUID.test(String(id))) return 0;
      const rows = await rest(`?id=eq.${id}&${ownerFilter(ownerId)}&select=id`, {
        method: "PATCH",
        prefer: "return=representation",
        body: JSON.stringify({ role }),
      });
      return Array.isArray(rows) ? rows.length : 0;
    })
  );
  return results.reduce((a, b) => a + b, 0);
}
