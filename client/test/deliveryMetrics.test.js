import test from "node:test";
import assert from "node:assert/strict";
import {
  createDeliveryTracker,
  countWords,
  SAMPLE_INTERVAL_MS,
} from "../src/utils/deliveryMetrics.js";

/**
 * The tracker is fed real loudness samples in the browser, so the only way to
 * test it is to synthesise a stream with known speech and silence in it and
 * check the numbers that come back out.
 *
 * These are not hypothetical cases: the noise-floor rule was wrong twice, and
 * both failures showed up here first — an answer that began the instant
 * recording started measured as pure silence, and word gaps ratcheted the floor
 * up until whole sentences were counted as pauses.
 */

const SPEECH = 0.05;
const SILENCE = 0.002;

/** @param {Array<{speaking: boolean, ms: number}>} script */
function feed(script, { tracker = createDeliveryTracker(), start = 1000 } = {}) {
  tracker.beginSegment();
  let now = start;
  for (const part of script) {
    const samples = Math.round(part.ms / SAMPLE_INTERVAL_MS);
    for (let i = 0; i < samples; i += 1) {
      // Jitter, so nothing here depends on a perfectly flat signal.
      const base = part.speaking ? SPEECH : SILENCE;
      tracker.push(base * (0.85 + Math.random() * 0.3), now);
      now += SAMPLE_INTERVAL_MS;
    }
  }
  tracker.endSegment();
  return { tracker, end: now };
}

const words = (n) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");

test("counts words the way a reader would", () => {
  assert.equal(countWords("  two   words \n here "), 3);
  assert.equal(countWords(""), 0);
  assert.equal(countWords(null), 0);
});

test("steady speech gives a plausible pace and no pauses", () => {
  const { tracker } = feed([
    { speaking: false, ms: 1000 },
    { speaking: true, ms: 60000 },
    { speaking: false, ms: 1000 },
  ]);
  const r = tracker.result(words(150));
  assert.equal(r.pauseCount, 0);
  assert.ok(r.wpm >= 140 && r.wpm <= 160, `wpm was ${r.wpm}`);
});

test("an answer that starts the instant recording does is still heard", () => {
  // Regression: the floor used to initialise from the first sample, so with no
  // leading silence it sat at speaking volume and the whole answer read as
  // silence.
  const { tracker } = feed([{ speaking: true, ms: 30000 }]);
  const r = tracker.result(words(110));
  assert.ok(r.speakingMs > 25000, `speakingMs was ${r.speakingMs}`);
  assert.ok(r.wpm >= 200, `wpm was ${r.wpm}`);
});

test("a long unbroken answer doesn't lose its own tail", () => {
  // Regression: the floor used to track upward during speech until the
  // threshold rose through the candidate's own voice.
  const { tracker } = feed([{ speaking: true, ms: 120000 }]);
  const r = tracker.result(words(240));
  assert.ok(r.speakingMs > 110000, `speakingMs was ${r.speakingMs}`);
  assert.equal(r.pauseCount, 0);
});

test("counts real mid-answer pauses", () => {
  const { tracker } = feed([
    { speaking: true, ms: 10000 },
    { speaking: false, ms: 3000 },
    { speaking: true, ms: 10000 },
    { speaking: false, ms: 3000 },
    { speaking: true, ms: 10000 },
  ]);
  const r = tracker.result(words(80));
  assert.equal(r.pauseCount, 2);
  assert.ok(r.pauseMs >= 5000 && r.pauseMs <= 7500, `pauseMs was ${r.pauseMs}`);
});

test("ordinary gaps between words are not pauses", () => {
  // Regression: these used to ratchet the noise floor up a notch each time.
  const script = Array.from({ length: 40 }, (_, i) =>
    i % 2 ? { speaking: false, ms: 300 } : { speaking: true, ms: 1200 }
  );
  const { tracker } = feed(script);
  assert.equal(tracker.result(words(60)).pauseCount, 0);
});

test("leading and trailing silence are not held against the candidate", () => {
  const { tracker } = feed([
    { speaking: false, ms: 8000 },
    { speaking: true, ms: 20000 },
    { speaking: false, ms: 8000 },
  ]);
  const r = tracker.result(words(50));
  assert.equal(r.pauseCount, 0);
  // Pace is over the spoken window, so 16s of dead air either side must not
  // drag it down.
  assert.ok(r.wpm >= 135 && r.wpm <= 165, `wpm was ${r.wpm}`);
});

test("pace is suppressed when there's too little to measure", () => {
  const { tracker } = feed([{ speaking: true, ms: 2000 }]);
  assert.equal(tracker.result("yes exactly").wpm, null);
});

test("silence throughout reports nothing rather than a confident zero", () => {
  const { tracker } = feed([{ speaking: false, ms: 20000 }]);
  const r = tracker.result("");
  assert.deepEqual(r, { wpm: null, pauseCount: null, pauseMs: null, speakingMs: null });
});

test("re-recording an answer accumulates across segments", () => {
  // ChatInput appends each new transcript onto the draft rather than replacing
  // it, so the metrics have to add up the same way.
  const tracker = createDeliveryTracker();
  const first = feed(
    [
      { speaking: true, ms: 8000 },
      { speaking: false, ms: 2500 },
      { speaking: true, ms: 8000 },
    ],
    { tracker }
  );
  feed([{ speaking: true, ms: 15000 }], { tracker, start: first.end + 30000 });

  const r = tracker.result(words(90));
  assert.equal(r.pauseCount, 1, "the pause in the first take still counts");
  // ~31s of speech across both takes, and the 30s the user spent thinking
  // between them must not be counted as either speech or a pause.
  assert.ok(r.speakingMs > 28000 && r.speakingMs < 34000, `speakingMs was ${r.speakingMs}`);
  assert.ok(r.wpm >= 140 && r.wpm <= 180, `wpm was ${r.wpm}`);
});
