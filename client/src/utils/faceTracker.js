/**
 * Eye-contact estimation for Speak mode.
 *
 * Runs MediaPipe's Face Landmarker over the local webcam <video> and measures
 * roughly how much of an answer the candidate spent facing the camera. It is a
 * head-orientation estimate, not gaze tracking — "were they looking at the
 * screen or down at their notes", nothing finer.
 *
 * PRIVACY: frames never leave the page. The model runs as WASM in this tab and
 * reads the <video> element directly; there is no canvas capture, no blob, no
 * upload, and nothing here retains a frame after it has been scored. The only
 * thing that escapes this module is a single percentage.
 *
 * Everything fails soft. A browser without the API, a blocked CDN, a machine too
 * slow to keep up — all resolve to null, `onCameraPct` stays null, and the
 * interview carries on with pace and pauses alone.
 */

// Pinned so the npm dependency and the CDN assets can never drift apart. Keep
// this in step with @mediapipe/tasks-vision in package.json.
const MEDIAPIPE_VERSION = "0.10.21";

// Two static-asset GETs, made once and then HTTP-cached: the WASM runtime and
// the model weights. Neither carries a request body — no user data, and
// certainly no video, is involved in fetching them. To self-host instead, drop
// both into client/public/ and point these two constants at the local paths.
const WASM_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

/** ~10 fps. Plenty to estimate a percentage, cheap enough to not heat a laptop. */
const SAMPLE_INTERVAL_MS = 100;

// Generous on purpose. This decides whether someone "looked away", and a false
// accusation is worse feedback than none — a candidate glancing at a second
// monitor should register, someone shifting in their chair should not.
const MAX_YAW_DEG = 25;
const MAX_PITCH_DEG = 20;

/** Too few samples to turn into a percentage worth reporting. */
const MIN_SAMPLES = 20;

const DEG = 180 / Math.PI;

/**
 * Head yaw/pitch, in degrees, from MediaPipe's 4x4 facial transformation matrix.
 *
 * The matrix is column-major, so its third column is the direction the face
 * points, in camera space. Facing the camera square-on that vector is ~(0,0,1);
 * turning away swings x, tilting swings y. Both are used as magnitudes, so the
 * sign convention doesn't matter — looking up and looking down are equally "away".
 */
function orientationFrom(matrix) {
  const m = matrix?.data;
  if (!m || m.length < 12) return null;
  const [fx, fy, fz] = [m[8], m[9], m[10]];
  return {
    yaw: Math.abs(Math.atan2(fx, fz) * DEG),
    pitch: Math.abs(Math.asin(Math.max(-1, Math.min(1, fy))) * DEG),
  };
}

/**
 * Loads the model and returns a tracker, or null if it can't be created for any
 * reason.
 *
 * @param {() => HTMLVideoElement|null} getVideo  resolved at sample time, not
 *   at creation: the model starts downloading as soon as permission is granted,
 *   which is typically before the preview element has mounted.
 */
export async function createFaceTracker(getVideo) {
  let landmarker;
  try {
    // Lazy — the ~7MB of WASM and weights is only paid for by someone who
    // actually starts a Speak-mode interview, the same way pdfjs-dist is only
    // paid for by someone who uploads a PDF.
    const { FilesetResolver, FaceLandmarker } = await import("@mediapipe/tasks-vision");
    const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
    landmarker = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
      runningMode: "VIDEO",
      numFaces: 1,
      // The head-pose matrix is the whole point: it gives real orientation
      // instead of a guess inferred from how far apart the 2D landmarks look.
      outputFacialTransformationMatrixes: true,
    });
  } catch (err) {
    console.warn("[faceTracker] unavailable — continuing without eye contact:", err?.message);
    return null;
  }

  let timer = null;
  let active = false;
  let closed = false;
  let lastVideoTime = -1;
  let lastTimestamp = -1;
  let samples = 0;
  let onScreen = 0;
  // Tracked apart from `onScreen` so "we never saw a face at all" can be told
  // from "we saw them, looking away". See result().
  let withFace = 0;

  function sampleOnce() {
    const videoEl = getVideo?.();
    if (!active || closed || !videoEl || videoEl.readyState < 2) return;

    // detectForVideo demands strictly increasing timestamps, and re-scoring a
    // frame we've already seen (backgrounded tab, stalled stream) would both
    // cost work and skew the percentage toward whatever that frame happened to
    // show. Skip until the stream actually advances.
    if (videoEl.currentTime === lastVideoTime) return;
    lastVideoTime = videoEl.currentTime;

    const timestamp = Math.max(performance.now(), lastTimestamp + 1);
    lastTimestamp = timestamp;

    let result;
    try {
      result = landmarker.detectForVideo(videoEl, timestamp);
    } catch {
      // A single bad frame shouldn't end tracking; a persistently broken
      // landmarker just means samples stay low and the metric ends up null.
      return;
    }

    samples += 1;

    const matrix = result?.facialTransformationMatrixes?.[0];
    const hasFace = Boolean(result?.faceLandmarks?.length);
    if (!hasFace) return; // no face in frame: looking away, or gone entirely
    withFace += 1;

    const angles = orientationFrom(matrix);
    // A face detected but no usable matrix still means they're in frame and
    // facing the camera enough to be recognised — count it rather than
    // penalising the candidate for our own missing data.
    if (!angles) {
      onScreen += 1;
      return;
    }
    if (angles.yaw <= MAX_YAW_DEG && angles.pitch <= MAX_PITCH_DEG) onScreen += 1;
  }

  return {
    /** Start a fresh answer: previous counts are discarded. */
    begin() {
      if (closed) return;
      samples = 0;
      onScreen = 0;
      withFace = 0;
      lastVideoTime = -1;
      active = true;
      clearInterval(timer);
      timer = setInterval(sampleOnce, SAMPLE_INTERVAL_MS);
    },

    /** Stop sampling but keep the counts, so result() can still be read. */
    end() {
      active = false;
      clearInterval(timer);
      timer = null;
    },

    /** @returns {number|null} percentage of the answer spent facing the camera. */
    result() {
      if (samples < MIN_SAMPLES) return null;
      // Not one frame contained a face for the entire answer. Far more likely a
      // covered lens, the wrong camera selected, or a room too dark than a
      // candidate who genuinely faced away for every second of it — and
      // reporting 0% would have the evaluator tell them they never made eye
      // contact. Say nothing rather than something false.
      if (withFace === 0) return null;
      return Math.round((onScreen / samples) * 100);
    },

    /** Release the model and its WASM backing. Safe to call twice. */
    close() {
      if (closed) return;
      closed = true;
      active = false;
      clearInterval(timer);
      timer = null;
      try {
        landmarker.close();
      } catch {
        /* already gone */
      }
    },
  };
}
