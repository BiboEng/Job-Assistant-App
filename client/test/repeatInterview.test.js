import test from "node:test";
import assert from "node:assert/strict";
import { repeatSettings, roleHeadline } from "../src/utils/repeatInterview.js";
import { QUESTION_COUNT_DEFAULT, QUESTION_COUNT_MAX, QUESTION_COUNT_MIN } from "../src/constants.js";

const JD = "Senior Frontend Engineer\nBuild accessible React components for a design system.";

test("a saved record repeats with its job description, count, focus and mode", () => {
  assert.deepEqual(
    repeatSettings({ jobDescription: `  ${JD}  `, totalQuestions: 4, focus: "technical", mode: "speak", feedback: {} }),
    { jobDescription: JD, questionCount: 4, focus: "technical", mode: "speak" }
  );
});

test("a live session's setup (questionCount) works the same way", () => {
  assert.equal(repeatSettings({ jobDescription: JD, questionCount: 2 }).questionCount, 2);
});

test("legacy or out-of-range fields fall back to today's defaults", () => {
  const out = repeatSettings({ jobDescription: JD, totalQuestions: 40, focus: "astrology", mode: null });
  assert.equal(out.questionCount, QUESTION_COUNT_MAX);
  assert.equal(out.focus, "mixed");
  assert.equal(out.mode, "type");
  assert.equal(repeatSettings({ jobDescription: JD, totalQuestions: 0 }).questionCount, QUESTION_COUNT_MIN);
  assert.equal(repeatSettings({ jobDescription: JD }).questionCount, QUESTION_COUNT_DEFAULT);
});

test("a job description that can't be sent any more can't be repeated", () => {
  assert.equal(repeatSettings({ jobDescription: "too short" }), null);
  assert.equal(repeatSettings({ jobDescription: "x".repeat(9000) }), null);
  assert.equal(repeatSettings(null), null);
  assert.equal(repeatSettings({}), null);
});

test("roleHeadline is the first non-empty line, capped", () => {
  assert.equal(roleHeadline("\n\n  Data Analyst \nbody"), "Data Analyst");
  assert.equal(roleHeadline("y".repeat(100)).length, 80);
  assert.equal(roleHeadline(undefined), "");
});
