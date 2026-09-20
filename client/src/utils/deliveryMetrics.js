/**
 * Speaking-delivery measurement: turns a stream of loudness samples into pause
 * and pace numbers. Pure — no Web Audio, no DOM, no timers of its own — so the
 * hook that owns the microphone can stay thin and this can be reasoned about (and
 * tested) on its own.
 *
 * Nothing here records or retains audio. The caller feeds in one RMS number per
 * sample; the samples themselves are not kept.
 */

/** How often the caller should sample. 50ms is fine enough to place a 1.5s gap. */
export const SAMPLE_INTERVAL_MS = 50;

/** A silence this long or longer, with speech on both sides, counts as a pause. */
export const PAUSE_MIN_MS = 1500;

// Hysteresis. Without it the ordinary gaps between words flicker the state
// machine and every sentence "contains" pauses.
const ENTER_SPEECH_MS = 150;
const LEAVE_SPEECH_MS = 250;

// The speech threshold floats above a running estimate of the room's noise
// floor, so a noisy room doesn't read as continuous speech and a very quiet one
// still registers a softly-spoken answer. Bounded at both ends so a pathological
// floor estimate can't disable detection entirely.
const THRESHOLD_MULTIPLIER = 2.5;
const MIN_THRESHOLD = 0.006;
const MAX_THRESHOLD = 0.08;

// The floor is learned ONLY from samples already judged to be silence: it drops
// to any quieter one instantly and climbs back over about a second. Letting a
// loud sample move it is self-defeating, and was wrong three separate ways —
// a long unbroken answer dragged the threshold up through its own voice until
// the tail read as silence; an answer that began the instant recording started
// left the floor initialised at speaking volume, so the whole thing read as
// silence; and the few loud samples inside the hysteresis window ratcheted the
// floor up a little on every single word gap. Hence a quiet default rather than
// the first sample, and the `!loud` guard below.
//
// A room that turns noisy mid-answer therefore stops adapting and reads as
// continuous speech. That's the right way round to fail: it under-reports
// pauses rather than inventing them.
const INITIAL_FLOOR = 0.004;
const FLOOR_RISE = 0.02;

// Below these, words-per-minute is arithmetic rather than information: a
// four-word answer can trivially "score" 300 wpm.
const MIN_WPM_WINDOW_MS = 5000;
const MIN_WPM_WORDS = 10;

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

/** Words in a transcript, counted the way a human would skim it. */
export function countWords(text) {
  return String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

/**
 * Accumulates across one whole answer, including re-recordings: each recording
 * is a *segment*, and pauses, speaking time and the spoken window are summed
 * across them. That matches ChatInput, which appends each new transcript onto
 * the draft rather than replacing it.
 *
 * Usage per segment: `beginSegment()`, then `push(rms, tMs)` per sample, then
 * `endSegment()`. Call `result(transcript)` once at submit time.
 */
export function createDeliveryTracker() {
  // Totals across the whole answer.
  let pauseCount = 0;
  let pauseMs = 0;
  let speakingMs = 0;
  let windowMs = 0; // first speech → last speech, summed over segments

  // Per-segment state.
  let inSegment = false;
  let floor = INITIAL_FLOOR;
  let speaking = false;
  let pendingSince = null; // when the raw signal started disagreeing with `speaking`
  let lastT = null;
  let firstSpeechAt = null;
  let lastSpeechAt = null;
  let silenceMs = 0; // length of the silent run in progress
  let segSpeakingMs = 0;

  function resetSegment() {
    floor = INITIAL_FLOOR;
    speaking = false;
    pendingSince = null;
    lastT = null;
    firstSpeechAt = null;
    lastSpeechAt = null;
    silenceMs = 0;
    segSpeakingMs = 0;
  }

  return {
    beginSegment() {
      resetSegment();
      inSegment = true;
    },

    /**
     * @param {number} level  RMS of the current frame, roughly 0–1.
     * @param {number} t      monotonic timestamp in ms (performance.now()).
     */
    push(level, t) {
      if (!inSegment) return;

      if (lastT === null) {
        lastT = t;
        return;
      }

      // Attribute the elapsed slice to the state we were actually in for it,
      // before considering a transition.
      const dt = Math.max(0, t - lastT);
      lastT = t;
      if (speaking) segSpeakingMs += dt;
      else if (firstSpeechAt !== null) silenceMs += dt;

      const threshold = clamp(floor * THRESHOLD_MULTIPLIER, MIN_THRESHOLD, MAX_THRESHOLD);
      const loud = level > threshold;

      // Learn the room only from what we already believe is silence.
      if (!loud) {
        if (level < floor) floor = level;
        else floor += (level - floor) * FLOOR_RISE;
      }

      if (loud === speaking) {
        pendingSince = null;
        return;
      }

      // The signal disagrees with our committed state — only act on it once it
      // has disagreed for long enough to not be a word boundary or a cough.
      if (pendingSince === null) pendingSince = t;
      const needed = loud ? ENTER_SPEECH_MS : LEAVE_SPEECH_MS;
      if (t - pendingSince < needed) return;
      pendingSince = null;

      if (loud) {
        if (firstSpeechAt === null) {
          // Leading silence is setup, not hesitation — it starts the window
          // rather than counting against it.
          firstSpeechAt = t;
        } else if (silenceMs >= PAUSE_MIN_MS) {
          pauseCount += 1;
          pauseMs += silenceMs;
        }
        silenceMs = 0;
        speaking = true;
      } else {
        lastSpeechAt = t;
        silenceMs = 0;
        speaking = false;
      }
    },

    endSegment() {
      if (!inSegment) return;
      inSegment = false;

      // A segment that ends mid-sentence still ends at the last sample. Whatever
      // silence trails the final word is never a pause: nothing follows it.
      if (speaking && lastT !== null) lastSpeechAt = lastT;
      if (firstSpeechAt !== null && lastSpeechAt !== null && lastSpeechAt > firstSpeechAt) {
        windowMs += lastSpeechAt - firstSpeechAt;
      }
      speakingMs += segSpeakingMs;
      resetSegment();
    },

    /**
     * Final metrics for the answer. A metric we couldn't measure comes back as
     * null rather than 0 — the evaluator reads "0 pauses" as a fact about the
     * candidate, and it shouldn't be told that when the truth is "we never heard
     * them speak".
     *
     * @param {string} transcript  the answer text, for the word count.
     */
    result(transcript) {
      const heardSpeech = windowMs > 0 || speakingMs > 0;
      const words = countWords(transcript);
      const usableWpm =
        heardSpeech && windowMs >= MIN_WPM_WINDOW_MS && words >= MIN_WPM_WORDS;

      return {
        wpm: usableWpm ? Math.round(words / (windowMs / 60000)) : null,
        pauseCount: heardSpeech ? pauseCount : null,
        pauseMs: heardSpeech ? Math.round(pauseMs) : null,
        speakingMs: heardSpeech ? Math.round(speakingMs) : null,
      };
    },
  };
}
