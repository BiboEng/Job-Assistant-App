import { randomUUID } from "node:crypto";

/**
 * The shape of a saved interview, shared by both history stores
 * (history.file.js, history.supabase.js). Pure: no I/O, so it's unit-tested.
 *
 * A record is what every caller sees, whichever store holds it:
 *   { id, ownerId, createdAt (ms), jobDescription, mode, focus,
 *     totalQuestions, qaPairs, feedback, role? }
 */

function titleOf(jd) {
  const firstLine = jd.split("\n").map((l) => l.trim()).find(Boolean) || jd.trim();
  return firstLine.slice(0, 80);
}

/**
 * The body of the posting, minus the line already used as the title — starting
 * at character zero made every history card read "<role> / <role> We're looking
 * for…". Falls back to the whole text for a single-line job description.
 */
function snippetOf(jd) {
  const lines = jd.split("\n");
  const firstIndex = lines.findIndex((l) => l.trim());
  const rest = firstIndex === -1 ? "" : lines.slice(firstIndex + 1).join(" ");
  const body = rest.trim() || jd.trim();
  return body.replace(/\s+/g, " ").slice(0, 140);
}

/**
 * A new record from what the save endpoint hands over.
 *
 * `mode` ("type" | "speak") and `focus` are kept so a saved interview can say
 * how it was taken, and each answer keeps its speak-mode `delivery` metrics
 * (null in type mode). Those were validated and clamped by normalizeDelivery
 * on the way in, so they're stored as-is.
 */
export function buildRecord({
  jobDescription,
  qaPairs,
  feedback,
  totalQuestions,
  mode = null,
  focus = null,
  ownerId = null,
}) {
  return {
    id: randomUUID(),
    ownerId,
    createdAt: Date.now(),
    jobDescription,
    mode,
    focus,
    totalQuestions: totalQuestions ?? (qaPairs ?? []).length,
    qaPairs: (qaPairs ?? []).map((p) => ({
      questionNumber: p.questionNumber,
      question: p.question,
      answer: p.answer || "",
      timeLimitSeconds: p.timeLimitSeconds ?? null,
      delivery: p.delivery ?? null,
    })),
    feedback,
  };
}

/** The dashboard's lightweight row for a record. */
export function summarize(record) {
  return {
    id: record.id,
    createdAt: record.createdAt,
    title: titleOf(record.jobDescription || ""),
    snippet: snippetOf(record.jobDescription || ""),
    overallScore: record.feedback?.overallScore ?? 0,
    mode: record.mode ?? null,
    totalQuestions: record.totalQuestions ?? record.qaPairs?.length ?? 0,
    answeredCount: (record.qaPairs ?? []).filter((p) => p.answer && p.answer.trim()).length,
  };
}

/**
 * The Supabase account behind an owner id, or null. Signed-in owners are
 * `u-<uuid without dashes>` (supabaseAuth.ownerIdForUser); anything else is a
 * legacy browser id with no account.
 */
export function ownerUserId(ownerId) {
  const m = /^u-([0-9a-f]{32})$/i.exec(String(ownerId || ""));
  if (!m) return null;
  const h = m[1].toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Record → `public.interview_history` row. */
export function recordToRow(record) {
  return {
    id: record.id,
    owner_id: record.ownerId,
    user_id: ownerUserId(record.ownerId),
    created_at: new Date(record.createdAt).toISOString(),
    job_description: record.jobDescription,
    mode: record.mode ?? null,
    focus: record.focus ?? null,
    total_questions: record.totalQuestions ?? 0,
    qa_pairs: record.qaPairs ?? [],
    feedback: record.feedback ?? {},
    role: record.role ?? null,
  };
}

/** `public.interview_history` row → record. */
export function rowToRecord(row) {
  const record = {
    id: row.id,
    ownerId: row.owner_id,
    createdAt: Date.parse(row.created_at),
    jobDescription: row.job_description ?? "",
    mode: row.mode ?? null,
    focus: row.focus ?? null,
    totalQuestions: row.total_questions ?? 0,
    qaPairs: Array.isArray(row.qa_pairs) ? row.qa_pairs : [],
    feedback: row.feedback ?? {},
  };
  if (row.role) record.role = row.role;
  return record;
}
