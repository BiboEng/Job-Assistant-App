import test from "node:test";
import assert from "node:assert/strict";
import {
  PLANS,
  PLAN_IDS,
  UNLIMITED_PLAN,
  checkInterviewSetup,
  planById,
  quotaFor,
  quotaMessage,
} from "../src/plans.js";
import { config } from "../src/config.js";

test("the plans are the approved tiers, in order of what they allow", () => {
  assert.deepEqual(PLAN_IDS, ["regular", "pro", "ultimate"]);
  const r = PLANS.regular;
  const p = PLANS.pro;
  const u = PLANS.ultimate;
  assert.deepEqual(
    [r.interviewsPerDay, p.interviewsPerDay, u.interviewsPerDay],
    [3, 15, 40]
  );
  assert.deepEqual([r.jobSearchesPerDay, p.jobSearchesPerDay, u.jobSearchesPerDay], [1, 5, 15]);
  assert.deepEqual(
    [r.resumeMessagesPerDay, p.resumeMessagesPerDay, u.resumeMessagesPerDay],
    [20, 100, 300]
  );
  assert.deepEqual([r.maxQuestions, p.maxQuestions, u.maxQuestions], [4, 6, 6]);
  assert.deepEqual(r.focuses, ["mixed", "behavioral"]);
  assert.deepEqual(p.focuses, config.interviewFocuses);
  assert.equal(r.speakMode, false);
  assert.equal(p.speakMode && u.speakMode, true);
  assert.equal(r.trackerCards, 15);
  assert.equal(p.trackerCards, null);
  assert.equal(r.historyVisible, 10);
  assert.equal(u.strongerEvaluator, true);
  assert.equal(p.strongerEvaluator, false);
});

test("every plan's model-call backstop covers what its own quotas can use", () => {
  // Generous upper bounds per action: an interview is at most one call per
  // question plus feedback (with one parse retry); a job search is one
  // profile call plus up to maxScored scoring calls; a resume turn may retry
  // once on an unparseable reply.
  for (const id of PLAN_IDS) {
    const plan = PLANS[id];
    const interviews = plan.interviewsPerDay * (plan.maxQuestions + 2);
    const searches = plan.jobSearchesPerDay * (1 + config.jobMatch.maxScored);
    const resume = plan.resumeMessagesPerDay * 2;
    assert.ok(
      plan.modelCallsPerDay >= interviews + searches + resume,
      `${id}: backstop ${plan.modelCallsPerDay} < ${interviews + searches + resume}`
    );
  }
});

test("an unknown plan id is Regular, never something better", () => {
  assert.equal(planById("gold"), PLANS.regular);
  assert.equal(planById(undefined), PLANS.regular);
  assert.equal(planById("ultimate"), PLANS.ultimate);
});

test("checkInterviewSetup allows what the plan includes", () => {
  assert.equal(checkInterviewSetup(PLANS.regular, {}), null);
  assert.equal(
    checkInterviewSetup(PLANS.regular, { questionCount: 4, focus: "behavioral", mode: "type" }),
    null
  );
  assert.equal(
    checkInterviewSetup(PLANS.pro, { questionCount: 6, focus: "system-design", mode: "speak" }),
    null
  );
  assert.equal(
    checkInterviewSetup(UNLIMITED_PLAN, { questionCount: 6, focus: "technical", mode: "speak" }),
    null
  );
});

test("checkInterviewSetup names what Regular doesn't include, and the plan that does", () => {
  const speak = checkInterviewSetup(PLANS.regular, { mode: "speak" });
  assert.equal(speak.feature, "speakMode");
  assert.equal(speak.requiredPlan, "pro");
  assert.match(speak.message, /Pro/);

  const focus = checkInterviewSetup(PLANS.regular, { focus: "technical" });
  assert.equal(focus.feature, "focus");
  assert.match(focus.message, /Technical/);

  const count = checkInterviewSetup(PLANS.regular, { questionCount: 5 });
  assert.equal(count.feature, "questionCount");
  assert.match(count.message, /up to 4/);
});

test("quotaFor and quotaMessage", () => {
  assert.equal(quotaFor(PLANS.regular, "interviews"), 3);
  assert.equal(quotaFor(UNLIMITED_PLAN, "jobSearches"), null);
  assert.equal(quotaFor(PLANS.pro, "somethingElse"), null);

  const msg = quotaMessage(PLANS.regular, "jobSearches");
  assert.match(msg, /all 1 job searches included in Regular today/);
  assert.match(msg, /midnight UTC/);
  assert.match(msg, /Pro includes 5 a day/);
  // Nothing above Ultimate to point at.
  assert.doesNotMatch(quotaMessage(PLANS.ultimate, "interviews"), /includes/);
});
