import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  SURVEY_STEPS,
  SURVEY_QUESTIONS,
  TOTAL_QUESTIONS,
} from "../src/survey/surveyQuestions.js";
import {
  answersToRow,
  emptyAnswers,
  hasAnyAnswer,
  rowToAnswers,
  SURVEY_COLUMNS,
} from "../src/survey/surveyMapping.js";

/**
 * The survey's questions live in JS and its constraints live in SQL, in a file
 * nothing imports. Nothing but this test stops the two drifting — and when they
 * drift the failure is a rejected insert at runtime, for one user, in
 * production, with a Postgres error string the UI has no good way to explain.
 *
 * The mapping is imported from `surveyMapping.js` rather than `surveyApi.js`
 * precisely so it can be tested here: `surveyApi.js` pulls in the Supabase
 * client, which reads `import.meta.env` at load time and throws under plain
 * node. Keeping the pure half separate is what makes any of this reachable
 * without a bundler.
 */

const MIGRATION = readFileSync(
  fileURLToPath(
    new URL(
      "../../supabase/migrations/20260921120000_user_survey_responses.sql",
      import.meta.url
    )
  ),
  "utf8"
);

test("there are exactly the fifteen questions that were asked for", () => {
  assert.equal(TOTAL_QUESTIONS, 15);
  assert.equal(
    SURVEY_STEPS.reduce((n, s) => n + s.questions.length, 0),
    15
  );
});

test("question ids and columns are unique", () => {
  const ids = SURVEY_QUESTIONS.map((q) => q.id);
  const cols = SURVEY_COLUMNS;
  assert.equal(new Set(ids).size, ids.length, "duplicate question id");
  assert.equal(new Set(cols).size, cols.length, "duplicate column");
});

test("every column the form writes exists in the migration", () => {
  for (const column of SURVEY_COLUMNS) {
    assert.ok(
      new RegExp(`^\\s{2}${column}\\s`, "m").test(MIGRATION),
      `column ${column} is written by the client but not declared in the migration`
    );
  }
});

test("every option value is inside its column's CHECK constraint", () => {
  for (const q of SURVEY_QUESTIONS) {
    if (!q.options) continue;
    // Grab the text between this column's name and the next blank line, which
    // is where its `check (...)` sits in the migration.
    const block = MIGRATION.split(new RegExp(`^\\s{2}${q.column}\\s`, "m"))[1];
    assert.ok(block, `no declaration found for ${q.column}`);
    const check = block.split("\n\n")[0];
    for (const option of q.options) {
      assert.ok(
        check.includes(`'${option.value}'`),
        `${q.column} option "${option.value}" is not allowed by the CHECK constraint`
      );
    }
  }
});

test("text limits match the char_length checks in the migration", () => {
  for (const q of SURVEY_QUESTIONS) {
    const fields = [
      q.maxLength ? { column: q.column, max: q.maxLength } : null,
      q.followUp ? { column: q.followUp.column, max: q.followUp.maxLength } : null,
    ].filter(Boolean);

    for (const { column, max } of fields) {
      assert.ok(
        MIGRATION.includes(`char_length(${column}) <= ${max}`),
        `${column} is capped at ${max} in the client but not in the migration`
      );
    }
  }
});

/* --- the mapping ------------------------------------------------------------ */

test("a blank answer set writes nulls and empty arrays, not empty strings", () => {
  const row = answersToRow(emptyAnswers());
  for (const q of SURVEY_QUESTIONS) {
    if (q.type === "multi") {
      assert.deepEqual(row[q.column], [], `${q.column} should be an empty array`);
    } else {
      assert.equal(row[q.column], null, `${q.column} should be null when skipped`);
    }
  }
  assert.equal(hasAnyAnswer(emptyAnswers()), false);
});

test("answers survive a round trip through the row shape", () => {
  const answers = {
    ...emptyAnswers(),
    career_stage: "mid_level",
    target_industry: "other",
    target_industry_other: "  Renewable energy  ",
    job_search_challenges: ["resume", "confidence"],
    target_role: "Staff Engineer",
    coach_wish: "Getting through the first five minutes without freezing.",
  };

  const row = answersToRow(answers);
  assert.equal(row.career_stage, "mid_level");
  assert.equal(row.target_industry_other, "Renewable energy", "should be trimmed");
  assert.deepEqual(row.job_search_challenges, ["resume", "confidence"]);

  const back = rowToAnswers(row);
  assert.equal(back.target_role, "Staff Engineer");
  assert.deepEqual(back.job_search_challenges, ["resume", "confidence"]);
  assert.equal(back.coach_wish, answers.coach_wish);
  assert.equal(hasAnyAnswer(answers), true);
});

test("an option value the question doesn't define is dropped, not sent", () => {
  // A stale value in local state must not fail the whole save — the CHECK
  // constraint would reject the row, and the user would lose fourteen good
  // answers to one bad one.
  const row = answersToRow({
    ...emptyAnswers(),
    career_stage: "supreme_overlord",
    app_goals: ["resume_building", "world_domination"],
  });
  assert.equal(row.career_stage, null);
  assert.deepEqual(row.app_goals, ["resume_building"]);
});

test("a follow-up is only stored while its trigger option is selected", () => {
  const answered = {
    ...emptyAnswers(),
    company_targeting: "specific",
    target_companies: "Stripe, Figma",
  };
  assert.equal(answersToRow(answered).target_companies, "Stripe, Figma");

  // The user went back and changed their mind: the free-text list must not
  // linger in a row that now says "open to anything".
  const changed = { ...answered, company_targeting: "open_to_anything" };
  assert.equal(answersToRow(changed).target_companies, null);
});

test("the salary opt-out clears the salary text", () => {
  const row = answersToRow({
    ...emptyAnswers(),
    salary_expectation: "90,000-120,000",
    salary_opt_out: true,
  });
  assert.equal(row.salary_opt_out, true);
  assert.equal(
    row.salary_expectation,
    null,
    "a row must not say both 'prefer not to say' and a number"
  );
  // Opting out is still an answer, so it must count as one.
  assert.equal(hasAnyAnswer({ ...emptyAnswers(), salary_opt_out: true }), true);
});

test("over-long free text is truncated to the column's limit", () => {
  const row = answersToRow({ ...emptyAnswers(), coach_wish: "x".repeat(5000) });
  assert.equal(row.coach_wish.length, 600);
});

test("a null row reads back as a blank, usable answer set", () => {
  assert.deepEqual(rowToAnswers(null), emptyAnswers());
  assert.deepEqual(rowToAnswers(undefined), emptyAnswers());
});

/* --- the guarantee ---------------------------------------------------------- */

test("no AI prompt or server module references the survey", () => {
  // The whole point of the feature as specified: collected now, wired into the
  // model later and deliberately. If a prompt ever starts reading these
  // answers, that has to be a decision someone makes on purpose — not a line
  // that slipped in. This test is the tripwire.
  const serverDir = fileURLToPath(new URL("../../server/src", import.meta.url));
  const hits = grepDir(serverDir, /user_survey_responses|surveyQuestions|careerSurvey/i);
  assert.deepEqual(
    hits,
    [],
    `server code must not reference the survey: ${hits.join(", ")}`
  );
});

/** Recursive grep, so the tripwire covers prompts/, services/ and controllers/. */
function grepDir(dir, pattern) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const full = `${dir}/${entry}`;
    if (statSync(full).isDirectory()) {
      found.push(...grepDir(full, pattern));
    } else if (entry.endsWith(".js") && pattern.test(readFileSync(full, "utf8"))) {
      found.push(full);
    }
  }
  return found;
}


