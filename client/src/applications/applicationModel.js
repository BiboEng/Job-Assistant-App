/**
 * The Application Tracker's data shape, and every pure rule about it.
 *
 * Split out from `applicationsApi.js` for the same reason the survey's mapping
 * is: the API module imports the Supabase client, which reads
 * `import.meta.env` at load time and throws under plain node. Everything here
 * is reachable from `client/test/applications.test.js` without a bundler —
 * including the checks that these values still match the migration's CHECK
 * constraints, which is the only thing that stops the two drifting.
 *
 * In the app an application is camelCase; in the table it is snake_case.
 * `rowToApplication` / `applicationToRow` are the only crossings.
 */

/** Every stage a card can be in, in board order. Must match the migration. */
export const STAGES = [
  { value: "saved", label: "Saved" },
  { value: "applied", label: "Applied" },
  { value: "interviewing", label: "Interviewing" },
  { value: "accepted", label: "Accepted" },
  { value: "rejected", label: "Rejected" },
];

const STAGE_VALUES = new Set(STAGES.map((s) => s.value));

/**
 * The four board columns. The last holds two stages, so a card keeps its
 * outcome while sharing the column — which is why stage and column are
 * different things.
 */
export const COLUMNS = [
  { id: "saved", label: "Saved", stages: ["saved"] },
  { id: "applied", label: "Applied", stages: ["applied"] },
  { id: "interviewing", label: "Interviewing", stages: ["interviewing"] },
  { id: "decided", label: "Accepted / Rejected", stages: ["accepted", "rejected"] },
];

/** Length caps. Must match the migration's `char_length` checks. */
export const APPLICATION_LIMITS = {
  company: 120,
  jobTitle: 160,
  postingUrl: 2048,
  notes: 4000,
  sourceJobId: 300,
};

/** Within this many days, an upcoming interview is flagged as "soon". */
export const INTERVIEW_SOON_DAYS = 7;

const DAY_MS = 86_400_000;

export function stageLabel(stage) {
  return STAGES.find((s) => s.value === stage)?.label ?? "Saved";
}

export function columnOf(stage) {
  return COLUMNS.find((c) => c.stages.includes(stage))?.id ?? "saved";
}

export function isHttpUrl(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const u = new URL(value.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function str(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/** "YYYY-MM-DD" or null. A date column round-trips as exactly this. */
function dateOnly(value) {
  if (typeof value !== "string") return null;
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(d.getTime()) && d.getDate() === Number(m[3]) ? m[0] : null;
}

/** A parseable instant as an ISO string, or null. */
function instant(value) {
  if (typeof value !== "string" || !value) return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** An empty draft for the "Add application" form. */
export function emptyDraft() {
  return {
    company: "",
    jobTitle: "",
    postingUrl: "",
    stage: "saved",
    notes: "",
    appliedOn: null,
    interviewAt: null,
  };
}

/** A table row → the shape the UI works with. Tolerates missing fields. */
export function rowToApplication(row) {
  const r = row || {};
  return {
    id: typeof r.id === "string" ? r.id : "",
    company: typeof r.company === "string" ? r.company : "",
    jobTitle: typeof r.job_title === "string" ? r.job_title : "",
    postingUrl: isHttpUrl(r.posting_url) ? r.posting_url : "",
    stage: STAGE_VALUES.has(r.stage) ? r.stage : "saved",
    notes: typeof r.notes === "string" ? r.notes : "",
    appliedOn: dateOnly(r.applied_on),
    interviewAt: instant(r.interview_at),
    source: r.source === "job_matches" ? "job_matches" : "manual",
    sourceJobId: typeof r.source_job_id === "string" ? r.source_job_id : null,
    createdAt: instant(r.created_at),
    updatedAt: instant(r.updated_at),
  };
}

/**
 * The UI shape (or any subset of it — a patch) → table columns. Only the keys
 * present are written, so an update never blanks a field it didn't mention.
 * Values are trimmed and capped here so a paste over the limit is clipped
 * rather than rejected by Postgres; `validateApplication` is what tells the
 * user about the things that can't be fixed silently.
 */
export function applicationToRow(app) {
  const a = app || {};
  const row = {};
  if ("company" in a) row.company = str(a.company, APPLICATION_LIMITS.company);
  if ("jobTitle" in a) row.job_title = str(a.jobTitle, APPLICATION_LIMITS.jobTitle);
  if ("postingUrl" in a) {
    const url = str(a.postingUrl, APPLICATION_LIMITS.postingUrl);
    row.posting_url = isHttpUrl(url) ? url : null;
  }
  if ("stage" in a) row.stage = STAGE_VALUES.has(a.stage) ? a.stage : "saved";
  if ("notes" in a) {
    row.notes = typeof a.notes === "string" ? a.notes.slice(0, APPLICATION_LIMITS.notes) : "";
  }
  if ("appliedOn" in a) row.applied_on = dateOnly(a.appliedOn);
  if ("interviewAt" in a) row.interview_at = instant(a.interviewAt);
  if ("source" in a) row.source = a.source === "job_matches" ? "job_matches" : "manual";
  if ("sourceJobId" in a) {
    const id = str(a.sourceJobId, APPLICATION_LIMITS.sourceJobId);
    row.source_job_id = id || null;
  }
  return row;
}

/**
 * Field errors for a draft, keyed by field. Empty object = valid. Only the
 * fields present are checked, so an in-place edit of one field validates just
 * that field.
 */
export function validateApplication(draft) {
  const d = draft || {};
  const errors = {};
  if ("company" in d && !str(d.company, Infinity)) errors.company = "Add the company name.";
  if ("jobTitle" in d && !str(d.jobTitle, Infinity)) errors.jobTitle = "Add the job title.";
  if ("postingUrl" in d) {
    const url = typeof d.postingUrl === "string" ? d.postingUrl.trim() : "";
    if (url && !isHttpUrl(url)) {
      errors.postingUrl = "Use a full link starting with http:// or https://.";
    } else if (url.length > APPLICATION_LIMITS.postingUrl) {
      errors.postingUrl = "That link is too long to save.";
    }
  }
  return errors;
}

/** Local calendar date for `now` as "YYYY-MM-DD". */
export function todayISO(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * The patch for moving a card to `stage`. Moving out of Saved into any later
 * stage fills in an empty application date with today — the move usually
 * *is* the moment of applying, and a blank date on an Applied card is the one
 * field people forget. An existing date is never overwritten.
 */
export function stagePatch(app, stage, now = new Date()) {
  const patch = { stage };
  if (stage !== "saved" && !app?.appliedOn) patch.appliedOn = todayISO(now);
  return patch;
}

/** A Job Matches result → a new application in Saved. */
export function draftFromJob(job) {
  const j = job || {};
  const company = str(j.company, APPLICATION_LIMITS.company);
  return {
    ...emptyDraft(),
    // Adzuna's "Company not disclosed" placeholder is still better than an
    // empty required field the insert would reject.
    company: company || "Company not disclosed",
    jobTitle: str(j.title, APPLICATION_LIMITS.jobTitle) || "Untitled role",
    postingUrl: isHttpUrl(j.url) ? j.url : "",
    stage: "saved",
    source: "job_matches",
    sourceJobId: str(j.id, APPLICATION_LIMITS.sourceJobId) || null,
  };
}

function startOfDay(ms) {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Whole calendar days from `now` to `then`, in local time (DST-safe). */
function calendarDaysBetween(nowMs, thenMs) {
  return Math.round((startOfDay(thenMs) - startOfDay(nowMs)) / DAY_MS);
}

/**
 * How a card flags its interview, or null when there's none.
 *
 *   tone "today"    — today, the loudest flag
 *   tone "soon"     — within INTERVIEW_SOON_DAYS
 *   tone "upcoming" — later than that
 *   tone "past"     — already happened; quiet, kept as a record
 *
 * `label` is the short card text; `full` is the long form for a tooltip or
 * a screen reader.
 */
export function interviewFlag(interviewAt, now = new Date(), locale) {
  if (!interviewAt) return null;
  const then = new Date(interviewAt).getTime();
  if (!Number.isFinite(then)) return null;
  const nowMs = now.getTime();

  const days = calendarDaysBetween(nowMs, then);
  const sameYear = new Date(then).getFullYear() === now.getFullYear();
  const time = new Date(then).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  const date = new Date(then).toLocaleDateString(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
  const full = `${new Date(then).toLocaleDateString(locale, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  })} at ${time}`;

  if (days < 0 || (days === 0 && then < nowMs)) {
    return { tone: "past", days, label: `Interviewed ${date}`, full: `Interviewed ${full}` };
  }
  if (days === 0) return { tone: "today", days, label: `Interview today · ${time}`, full: `Interview today, ${full}` };
  if (days === 1) {
    return { tone: "soon", days, label: `Interview tomorrow · ${time}`, full: `Interview tomorrow, ${full}` };
  }
  if (days <= INTERVIEW_SOON_DAYS) {
    return { tone: "soon", days, label: `Interview ${date} · ${time}`, full: `Interview on ${full}` };
  }
  return { tone: "upcoming", days, label: `Interview on ${date}`, full: `Interview on ${full}` };
}

/**
 * Applications → `{ [columnId]: application[] }`, every column present.
 *
 * Within a column, cards with an interview still ahead come first, soonest at
 * the top — that is the thing the board is for. Everything else follows,
 * most recently touched first, so a card you just moved lands at the top of
 * its new column (updated_at is bumped by the table's trigger).
 */
export function groupByColumn(applications, now = new Date()) {
  const groups = Object.fromEntries(COLUMNS.map((c) => [c.id, []]));
  for (const app of applications || []) groups[columnOf(app.stage)].push(app);

  const nowMs = now.getTime();
  const ahead = (app) => {
    const t = app.interviewAt ? new Date(app.interviewAt).getTime() : NaN;
    return Number.isFinite(t) && t >= nowMs ? t : null;
  };
  const touched = (app) => new Date(app.updatedAt || app.createdAt || 0).getTime() || 0;

  for (const list of Object.values(groups)) {
    list.sort((a, b) => {
      const ta = ahead(a);
      const tb = ahead(b);
      if (ta !== null && tb !== null) return ta - tb;
      if (ta !== null) return -1;
      if (tb !== null) return 1;
      return touched(b) - touched(a);
    });
  }
  return groups;
}

/** A stored instant → the value a `<input type="datetime-local">` expects. */
export function toLocalInputValue(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}`;
}

/** A `datetime-local` value (local wall time) → an ISO instant, or null. */
export function fromLocalInputValue(value) {
  if (typeof value !== "string" || !value) return null;
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

/** "2026-09-12" → "Sep 12" (with the year when it isn't this year). */
export function formatDay(isoDate, now = new Date(), locale) {
  const day = dateOnly(isoDate);
  if (!day) return "";
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    ...(y === now.getFullYear() ? {} : { year: "numeric" }),
  });
}
