import test from "node:test";
import assert from "node:assert/strict";
import { normalizeFeedback } from "../src/controllers/interview.controller.js";

const pairs = [
  { questionNumber: 1, question: "Q1", answer: "a real answer", timeLimitSeconds: 90 },
  { questionNumber: 2, question: "Q2", answer: "   ", timeLimitSeconds: 120 }, // skipped
];

test("clamps overallScore and per-question score to range", () => {
  const out = normalizeFeedback(
    { overallScore: 999, perQuestion: [{ questionNumber: 1, score: 42 }] },
    pairs
  );
  assert.equal(out.overallScore, 100);
  assert.equal(out.perQuestion[0].score, 10);
});

test("skipped questions are kept and scored 0", () => {
  const out = normalizeFeedback({ perQuestion: [{ questionNumber: 1, score: 8 }] }, pairs);
  assert.equal(out.perQuestion.length, 2);
  assert.equal(out.perQuestion[1].questionNumber, 2);
  assert.equal(out.perQuestion[1].score, 0);
  assert.match(out.perQuestion[1].comment, /no answer/i);
});

test("matches per-question feedback by questionNumber, not order", () => {
  const out = normalizeFeedback(
    {
      perQuestion: [
        { questionNumber: 2, score: 3, comment: "for two" },
        { questionNumber: 1, score: 9, comment: "for one" },
      ],
    },
    pairs
  );
  assert.equal(out.perQuestion[0].comment, "for one");
});

test("tolerates garbage shapes", () => {
  const out = normalizeFeedback(null, pairs);
  assert.equal(out.overallScore, 0);
  assert.deepEqual(out.strengths, []);
  assert.equal(out.perQuestion.length, 2);
});
