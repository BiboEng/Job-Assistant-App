import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  APPLICATION_LIMITS,
  COLUMNS,
  STAGES,
  applicationToRow,
  columnOf,
  draftFromJob,
  emptyDraft,
  fromLocalInputValue,
  groupByColumn,
  interviewFlag,
  rowToApplication,
  stagePatch,
  toLocalInputValue,
  todayISO,
  validateApplication,
} from "../src/applications/applicationModel.js";

/**
 * The Application Tracker's stages and caps live in JS; its constraints live
 * in SQL, in a file nothing imports. When they drift the failure is a rejected
 * insert for one user at runtime, so these tests read the migration as text
 * and hold the two together — the same arrangement as survey.test.js.
 */

const MIGRATION = readFileSync(
  fileURLToPath(
    new URL("../../supabase/migrations/20260927100000_user_applications.sql", import.meta.url)
  ),
  "utf8"
);

// Wednesday 30 September 2026, 10:00 local time.
const NOW = new Date(2026, 8, 30, 10, 0);
const at = (y, m, d, h = 12, min = 0) => new Date(y, m - 1, d, h, min).toISOString();

/* --- migration ↔ model ----------------------------------------------------- */

test("every stage is allowed by the stage CHECK constraint, and no others", () => {
  const check = MIGRATION.match(/stage in \(([^)]*)\)/);
  assert.ok(check, "no stage check in the migration");
  const allowed = [...check[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual(allowed, STAGES.map((s) => s.value));
});

test("the four columns cover every stage exactly once, in board order", () => {
  assert.equal(COLUMNS.length, 4);
  assert.deepEqual(
    COLUMNS.map((c) => c.label),
    ["Saved", "Applied", "Interviewing", "Accepted / Rejected"]
  );
  const covered = COLUMNS.flatMap((c) => c.stages);
  assert.deepEqual([...covered].sort(), STAGES.map((s) => s.value).sort());
  assert.equal(new Set(covered).size, covered.length);
});

test("length caps match the migration's char_length checks", () => {
  const cap = (column) => {
    const m =
      MIGRATION.match(new RegExp(`char_length\\(${column}\\) between 1 and (\\d+)`)) ||
      MIGRATION.match(new RegExp(`char_length\\(${column}\\) <= (\\d+)`));
    assert.ok(m, `no char_length cap for ${column}`);
    return Number(m[1]);
  };
  assert.equal(cap("company"), APPLICATION_LIMITS.company);
  assert.equal(cap("job_title"), APPLICATION_LIMITS.jobTitle);
  assert.equal(cap("posting_url"), APPLICATION_LIMITS.postingUrl);
  assert.equal(cap("notes"), APPLICATION_LIMITS.notes);
  assert.equal(cap("source_job_id"), APPLICATION_LIMITS.sourceJobId);
});

test("every column the client writes is declared in the migration", () => {
  const row = applicationToRow({
    ...emptyDraft(),
    postingUrl: "https://example.com",
    appliedOn: "2026-09-01",
    interviewAt: at(2026, 10, 2),
    source: "job_matches",
    sourceJobId: "adzuna:1",
  });
  for (const column of [...Object.keys(row), "user_id"]) {
    assert.ok(
      new RegExp(`^\\s{2}${column}\\s`, "m").test(MIGRATION),
      `${column} is written by the client but not declared in the migration`
    );
  }
});

test("RLS is on with an owner-only policy for each verb", () => {
  assert.match(MIGRATION, /alter table public\.user_applications enable row level security/);
  for (const verb of ["select", "insert", "update", "delete"]) {
    assert.match(
      MIGRATION,
      new RegExp(`for ${verb} (using|with check) \\(auth\\.uid\\(\\) = user_id\\)`),
      `no owner-only ${verb} policy`
    );
  }
});

test("the API server knows nothing about the applications table", () => {
  // Same tripwire as the survey: the tracker is browser ↔ Supabase only, and
  // no prompt reads it. Wiring it into the server should be a decision.
  const root = fileURLToPath(new URL("../../server/src/", import.meta.url));
  const walk = (dir) =>
    readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry);
      return statSync(full).isDirectory() ? walk(full) : [full];
    });
  const hits = walk(root).filter((f) => readFileSync(f, "utf8").includes("user_applications"));
  assert.deepEqual(hits, []);
});

/* --- row mapping ----------------------------------------------------------- */

test("a row maps to the app shape and back", () => {
  const row = {
    id: "a1",
    user_id: "u1",
    company: "Acme",
    job_title: "Frontend Engineer",
    posting_url: "https://jobs.example.com/1",
    stage: "interviewing",
    notes: "Recruiter: Sam",
    applied_on: "2026-09-12",
    interview_at: "2026-10-02T14:00:00+00:00",
    source: "job_matches",
    source_job_id: "adzuna:42",
    created_at: "2026-09-10T08:00:00+00:00",
    updated_at: "2026-09-20T08:00:00+00:00",
  };
  const app = rowToApplication(row);
  assert.equal(app.jobTitle, "Frontend Engineer");
  assert.equal(app.appliedOn, "2026-09-12");
  assert.equal(app.interviewAt, "2026-10-02T14:00:00.000Z");
  assert.equal(app.source, "job_matches");

  const back = applicationToRow(app);
  assert.equal(back.job_title, row.job_title);
  assert.equal(back.posting_url, row.posting_url);
  assert.equal(back.stage, row.stage);
  assert.equal(back.applied_on, row.applied_on);
  assert.equal(new Date(back.interview_at).getTime(), new Date(row.interview_at).getTime());
  assert.equal(back.source_job_id, row.source_job_id);
  assert.ok(!("user_id" in back), "user_id is the API's to set, not the mapping's");
});

test("a partial patch writes only the fields it names", () => {
  assert.deepEqual(applicationToRow({ notes: "hi" }), { notes: "hi" });
  assert.deepEqual(applicationToRow({ stage: "applied", appliedOn: "2026-09-30" }), {
    stage: "applied",
    applied_on: "2026-09-30",
  });
});

test("bad values are coerced to something the constraints accept", () => {
  const row = applicationToRow({
    company: "  Acme  ",
    jobTitle: "x".repeat(500),
    postingUrl: "javascript:alert(1)",
    stage: "ghosted",
    notes: "n".repeat(5000),
    appliedOn: "2026-02-31",
    interviewAt: "not a date",
    source: "linkedin",
    sourceJobId: "",
  });
  assert.equal(row.company, "Acme");
  assert.equal(row.job_title.length, APPLICATION_LIMITS.jobTitle);
  assert.equal(row.posting_url, null);
  assert.equal(row.stage, "saved");
  assert.equal(row.notes.length, APPLICATION_LIMITS.notes);
  assert.equal(row.applied_on, null);
  assert.equal(row.interview_at, null);
  assert.equal(row.source, "manual");
  assert.equal(row.source_job_id, null);
});

test("an unknown stage or unsafe link from the table never reaches the UI", () => {
  const app = rowToApplication({ id: "x", stage: "weird", posting_url: "ftp://x" });
  assert.equal(app.stage, "saved");
  assert.equal(app.postingUrl, "");
});

/* --- validation ------------------------------------------------------------ */

test("company and title are required; the link is optional but must be http(s)", () => {
  assert.deepEqual(Object.keys(validateApplication(emptyDraft())).sort(), ["company", "jobTitle"]);
  assert.deepEqual(
    validateApplication({ company: "A", jobTitle: "B", postingUrl: "" }),
    {}
  );
  assert.ok(validateApplication({ postingUrl: "example.com/job" }).postingUrl);
  assert.deepEqual(validateApplication({ postingUrl: "https://example.com/job" }), {});
  // A patch of one field is validated on that field alone.
  assert.deepEqual(validateApplication({ notes: "" }), {});
});

/* --- stages and columns ---------------------------------------------------- */

test("accepted and rejected share the last column", () => {
  assert.equal(columnOf("accepted"), "decided");
  assert.equal(columnOf("rejected"), "decided");
  assert.equal(columnOf("saved"), "saved");
  assert.equal(columnOf("nonsense"), "saved");
});

test("leaving Saved fills an empty application date, but never overwrites one", () => {
  assert.deepEqual(stagePatch({ appliedOn: null }, "applied", NOW), {
    stage: "applied",
    appliedOn: "2026-09-30",
  });
  assert.deepEqual(stagePatch({ appliedOn: "2026-09-01" }, "interviewing", NOW), {
    stage: "interviewing",
  });
  assert.deepEqual(stagePatch({ appliedOn: null }, "saved", NOW), { stage: "saved" });
  assert.equal(todayISO(new Date(2026, 0, 5)), "2026-01-05");
});

test("groupByColumn: every column present; interviews ahead first, then most recent", () => {
  const apps = [
    { id: "old", stage: "applied", updatedAt: at(2026, 9, 1) },
    { id: "new", stage: "applied", updatedAt: at(2026, 9, 29) },
    { id: "later", stage: "applied", interviewAt: at(2026, 10, 20), updatedAt: at(2026, 9, 2) },
    { id: "sooner", stage: "applied", interviewAt: at(2026, 10, 1), updatedAt: at(2026, 9, 2) },
    { id: "past", stage: "applied", interviewAt: at(2026, 9, 1), updatedAt: at(2026, 9, 3) },
    { id: "won", stage: "accepted", updatedAt: at(2026, 9, 5) },
    { id: "lost", stage: "rejected", updatedAt: at(2026, 9, 6) },
  ];
  const groups = groupByColumn(apps, NOW);
  assert.deepEqual(Object.keys(groups), ["saved", "applied", "interviewing", "decided"]);
  assert.deepEqual(groups.saved, []);
  assert.deepEqual(
    groups.applied.map((a) => a.id),
    ["sooner", "later", "new", "past", "old"]
  );
  assert.deepEqual(groups.decided.map((a) => a.id), ["lost", "won"]);
});

/* --- interview flag -------------------------------------------------------- */

test("interviewFlag: none, today, tomorrow, this week, later, past", () => {
  assert.equal(interviewFlag(null, NOW), null);
  assert.equal(interviewFlag("garbage", NOW), null);

  const today = interviewFlag(at(2026, 9, 30, 15, 30), NOW, "en-US");
  assert.equal(today.tone, "today");
  assert.match(today.label, /^Interview today · 3:30\sPM$/);

  const tomorrow = interviewFlag(at(2026, 10, 1, 9, 0), NOW, "en-US");
  assert.equal(tomorrow.tone, "soon");
  assert.match(tomorrow.label, /^Interview tomorrow · 9:00\sAM$/);

  const week = interviewFlag(at(2026, 10, 6, 11, 0), NOW, "en-US");
  assert.equal(week.tone, "soon");
  assert.match(week.label, /^Interview Tue, Oct 6 · 11:00\sAM$/);

  const later = interviewFlag(at(2026, 10, 20), NOW, "en-US");
  assert.equal(later.tone, "upcoming");
  assert.equal(later.label, "Interview on Tue, Oct 20");

  const nextYear = interviewFlag(at(2027, 1, 12), NOW, "en-US");
  assert.equal(nextYear.label, "Interview on Tue, Jan 12, 2027");

  const past = interviewFlag(at(2026, 9, 25), NOW, "en-US");
  assert.equal(past.tone, "past");
  assert.equal(past.label, "Interviewed Fri, Sep 25");

  // Earlier today counts as done, not as "today".
  assert.equal(interviewFlag(at(2026, 9, 30, 8, 0), NOW, "en-US").tone, "past");
});

/* --- Job Matches → draft --------------------------------------------------- */

test("draftFromJob pre-fills company, title and link, lands in Saved", () => {
  const draft = draftFromJob({
    id: "adzuna:99",
    company: "Globex",
    title: "Data Analyst",
    url: "https://www.adzuna.com/land/ad/99",
    location: "Austin",
  });
  assert.equal(draft.company, "Globex");
  assert.equal(draft.jobTitle, "Data Analyst");
  assert.equal(draft.postingUrl, "https://www.adzuna.com/land/ad/99");
  assert.equal(draft.stage, "saved");
  assert.equal(draft.source, "job_matches");
  assert.equal(draft.sourceJobId, "adzuna:99");
  assert.deepEqual(validateApplication(draft), {});
});

test("draftFromJob never produces a row the NOT NULL columns would reject", () => {
  const draft = draftFromJob({ id: "adzuna:1", url: "not a url" });
  assert.ok(draft.company);
  assert.ok(draft.jobTitle);
  assert.equal(draft.postingUrl, "");
});

/* --- datetime-local round trip --------------------------------------------- */

test("datetime-local values round-trip through a stored instant", () => {
  assert.equal(toLocalInputValue(fromLocalInputValue("2026-10-02T14:05")), "2026-10-02T14:05");
  assert.equal(fromLocalInputValue(""), null);
  assert.equal(toLocalInputValue(null), "");
});
