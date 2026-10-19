import test from "node:test";
import assert from "node:assert/strict";
import { readiness, stageOf, READINESS_WEIGHTS } from "../src/utils/readiness.js";

const r = (relevance, specificity, structure, depth) => ({ relevance, specificity, structure, depth });
const it = (overallScore, rubric = null) => ({ overallScore, rubric });
const factor = (res, key) => res.factors.find((f) => f.key === key);

test("no scored interview gives no readiness", () => {
  assert.equal(readiness([]), null);
  assert.equal(readiness(null), null);
  assert.equal(readiness([it(null), it("x")]), null);
});

test("weights add up to 100", () => {
  assert.equal(Object.values(READINESS_WEIGHTS).reduce((a, b) => a + b, 0), 100);
});

test("stages cut at 40, 60 and 80", () => {
  assert.equal(stageOf(0).label, "Not ready");
  assert.equal(stageOf(39).label, "Not ready");
  assert.equal(stageOf(40).label, "Getting there");
  assert.equal(stageOf(60).label, "Almost ready");
  assert.equal(stageOf(79).label, "Almost ready");
  assert.equal(stageOf(80).label, "Ready");
  assert.equal(stageOf(100).label, "Ready");
});

test("recent performance averages the last three scores", () => {
  const res = readiness([it(10), it(60), it(70), it(80)]);
  assert.equal(factor(res, "performance").value, 70);
  assert.equal(factor(res, "performance").detail.count, 3);
});

test("one interview: consistency is pending and holds readiness back", () => {
  const res = readiness([it(100, r(10, 10, 10, 10))]);
  const c = factor(res, "consistency");
  assert.equal(c.status, "pending");
  assert.equal(c.value, null, "shown as no value, never 0");
  // 45 (performance) + 20 (quality) + 0 (consistency) + 3 (volume 20% of 15)
  assert.equal(res.score, 68);
  assert.notEqual(res.stage.key, "ready", "one interview is never Ready");
});

test("consistency falls with spread", () => {
  const steady = factor(readiness([it(70), it(70), it(70)]), "consistency");
  const swingy = factor(readiness([it(40), it(90), it(45), it(85)]), "consistency");
  assert.equal(steady.value, 100);
  assert.ok(swingy.value < 30, `got ${swingy.value}`);
  assert.deepEqual([swingy.detail.low, swingy.detail.high], [40, 90]);
});

test("readiness never runs ahead of recent performance", () => {
  const res = readiness([it(20, r(9, 9, 9, 9)), it(20, r(9, 9, 9, 9)), it(20, r(9, 9, 9, 9)), it(20), it(20)]);
  assert.equal(res.score, 20);
  assert.equal(res.capped, true);
  assert.equal(res.stage.label, "Not ready");
});

test("the weakest rubric dimension over the last three rated interviews", () => {
  const res = readiness([
    it(70, r(1, 1, 1, 1)), // outside the window
    it(70, r(8, 6, 4, 7)),
    it(70, null), // not rated, skipped
    it(70, r(8, 6, 5, 7)),
    it(70, r(8, 6, 6, 7)),
  ]);
  const q = factor(res, "quality");
  assert.equal(q.status, "measured");
  assert.equal(q.detail.dimension.key, "structure");
  assert.equal(q.detail.average, 5);
  assert.equal(q.value, 50);
  assert.equal(res.focus, "quality");
});

test("no rubric data leaves quality out and rescales the other weights", () => {
  const scores = [it(80), it(80), it(80), it(80), it(80)];
  const unrated = readiness(scores);
  assert.equal(factor(unrated, "quality").status, "unrated");
  // performance 80 × 45, consistency 100 × 20, volume 100 × 15 over 80 → 89, capped to 80
  assert.equal(unrated.score, 80);

  const locked = readiness(
    scores.map((s) => ({ ...s, rubric: r(2, 2, 2, 2) })),
    { insights: false }
  );
  assert.equal(factor(locked, "quality").status, "locked");
  assert.equal(locked.score, 80, "a plan without insights isn't penalised for the missing rubric");
});

test("volume counts up to five interviews", () => {
  assert.equal(factor(readiness([it(50), it(50)]), "volume").value, 40);
  assert.equal(factor(readiness(Array.from({ length: 8 }, () => it(50))), "volume").value, 100);
});

test("focus points at the lowest measured factor, and nowhere once all are high", () => {
  assert.equal(readiness([it(85), it(86)]).focus, "volume");
  const strong = readiness(Array.from({ length: 5 }, () => it(90, r(9, 9, 9, 9))));
  assert.equal(strong.focus, null);
  assert.equal(strong.stage.label, "Ready");
});
