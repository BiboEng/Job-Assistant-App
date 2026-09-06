import test from "node:test";
import assert from "node:assert/strict";
import { estimateAnswerSeconds } from "../src/timeLimit.js";

test("clamps to the configured 60–300s range", () => {
  assert.equal(estimateAnswerSeconds(""), 60);
  const long =
    "Walk me through, step by step and in detail, how you would architect and " +
    "design a large distributed system, and tell me about a time you did this, " +
    "and what trade-offs you weighed, and why, and how did you measure success?";
  const s = estimateAnswerSeconds(long);
  assert.ok(s >= 60 && s <= 300, `expected 60..300, got ${s}`);
});

test("rounds to 15s increments", () => {
  for (const q of ["Tell me about yourself.", "Why this role? How would you approach the first 90 days?"]) {
    assert.equal(estimateAnswerSeconds(q) % 15, 0);
  }
});

test("open-ended prompts get more time than quick factual ones", () => {
  const quick = estimateAnswerSeconds("What is your favourite language?");
  const deep = estimateAnswerSeconds(
    "Tell me about a time you led a difficult migration. Walk me through your approach in detail."
  );
  assert.ok(deep > quick, `expected deep(${deep}) > quick(${quick})`);
});
