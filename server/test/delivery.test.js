import test from "node:test";
import assert from "node:assert/strict";
import { normalizeDelivery } from "../src/controllers/interview.controller.js";
import {
  evaluatorSystemPrompt,
  transcriptForEvaluator,
} from "../src/prompts/index.js";

const speak = { mode: "speak" };
const type = { mode: "type" };

const full = { wpm: 142, pauseCount: 3, pauseMs: 6200, speakingMs: 48000, onCameraPct: 78 };

// --- normalizeDelivery ----------------------------------------------------

test("keeps a well-formed delivery object as-is", () => {
  assert.deepEqual(normalizeDelivery(full, speak), full);
});

test("returns null for a type-mode session, however good the payload", () => {
  assert.equal(normalizeDelivery(full, type), null);
  assert.equal(normalizeDelivery(full, {}), null);
});

test("clamps every metric into range", () => {
  const out = normalizeDelivery(
    { wpm: 9000, pauseCount: -4, pauseMs: 99_999_999, speakingMs: -1, onCameraPct: 150 },
    speak
  );
  assert.equal(out.wpm, 400);
  assert.equal(out.pauseCount, 0);
  assert.equal(out.pauseMs, 600_000);
  assert.equal(out.speakingMs, 0);
  assert.equal(out.onCameraPct, 100);
});

test("drops unknown keys — only the numeric allowlist survives", () => {
  const out = normalizeDelivery(
    { wpm: 120, videoFrames: "data:image/png;base64,AAAA", transcriptAudio: {} },
    speak
  );
  assert.deepEqual(Object.keys(out).sort(), [
    "onCameraPct",
    "pauseCount",
    "pauseMs",
    "speakingMs",
    "wpm",
  ]);
  assert.equal(out.wpm, 120);
});

test("an unmeasurable metric stays null rather than becoming zero", () => {
  const out = normalizeDelivery({ pauseCount: 2, pauseMs: 4000 }, speak);
  assert.equal(out.wpm, null);
  assert.equal(out.onCameraPct, null);
  assert.equal(out.pauseCount, 2);
});

test("a pause total with no pause count is discarded", () => {
  const out = normalizeDelivery({ wpm: 130, pauseMs: 5000 }, speak);
  assert.equal(out.pauseMs, null);
});

test("returns null when nothing usable came through", () => {
  assert.equal(normalizeDelivery({}, speak), null);
  assert.equal(normalizeDelivery({ wpm: "fast" }, speak), null);
  assert.equal(normalizeDelivery(null, speak), null);
  assert.equal(normalizeDelivery("nope", speak), null);
  assert.equal(normalizeDelivery([1, 2, 3], speak), null);
});

// --- transcript rendering -------------------------------------------------

const withDelivery = [
  { questionNumber: 1, question: "Q one", answer: "A one", delivery: full },
];

test("renders a D line under the answer", () => {
  const out = transcriptForEvaluator(withDelivery);
  assert.match(out, /^Q1: Q one\nA1: A one\nD1: /m);
  assert.match(out, /pace 142 wpm/);
  assert.match(out, /3 pauses totalling 6s/);
  assert.match(out, /looking at camera 78% of the time/);
});

test("omits metrics that are null", () => {
  const out = transcriptForEvaluator([
    { questionNumber: 1, question: "Q", answer: "A", delivery: { ...full, onCameraPct: null } },
  ]);
  assert.doesNotMatch(out, /camera/);
  assert.match(out, /pace 142 wpm/);
});

test("says so plainly when there were no pauses", () => {
  const out = transcriptForEvaluator([
    { questionNumber: 1, question: "Q", answer: "A", delivery: { pauseCount: 0, pauseMs: 0 } },
  ]);
  assert.match(out, /no significant pauses/);
});

test("a type-mode transcript is unchanged — no D line anywhere", () => {
  const pairs = [
    { questionNumber: 1, question: "Q one", answer: "A one", delivery: null },
    { questionNumber: 2, question: "Q two", answer: "" },
  ];
  assert.equal(
    transcriptForEvaluator(pairs),
    "Q1: Q one\nA1: A one\n\nQ2: Q two\nA2: (no answer given)"
  );
});

// --- evaluator prompt -----------------------------------------------------

test("speak mode adds delivery guidance", () => {
  const out = evaluatorSystemPrompt("Some role", { mode: "speak" });
  assert.match(out, /DELIVERY DATA/);
  assert.match(out, /must NOT change any "score"/);
  assert.match(out, /Never diagnose/);
});

test("type mode produces exactly the prompt it always has", () => {
  const base = evaluatorSystemPrompt("Some role");
  assert.doesNotMatch(base, /DELIVERY DATA/);
  assert.equal(evaluatorSystemPrompt("Some role", { mode: "type" }), base);
  assert.equal(evaluatorSystemPrompt("Some role", {}), base);
});
