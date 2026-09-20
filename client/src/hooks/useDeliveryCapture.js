import { useCallback, useEffect, useRef, useState } from "react";
import { createDeliveryTracker, SAMPLE_INTERVAL_MS } from "../utils/deliveryMetrics.js";
import { createFaceTracker } from "../utils/faceTracker.js";

/**
 * Owns everything Speak mode needs from the user's hardware: one camera+mic
 * MediaStream, a Web Audio analyser over its audio track, and the MediaPipe face
 * tracker over its video track.
 *
 * PRIVACY: the stream has exactly two consumers, both local — a <video> element
 * for the self-view and an AnalyserNode for loudness. There is no MediaRecorder
 * and no upload path anywhere in this file; the only thing that leaves it is a
 * handful of integers. (The transcript itself is a separate matter — that comes
 * from the Web Speech API, which does send audio to the browser's speech
 * provider. ChatInput discloses that.)
 *
 * Teardown is centralised in `release()` so there is exactly one place that has
 * to be right for the camera light to go out.
 */

export const PERMISSION_UNSUPPORTED = "unsupported";
export const PERMISSION_IDLE = "idle";
export const PERMISSION_REQUESTING = "requesting";
export const PERMISSION_GRANTED = "granted";
export const PERMISSION_DENIED = "denied";

const supportsMedia = () =>
  typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);

/**
 * Turn a getUserMedia rejection into something worth showing a candidate. The
 * distinction that matters is "you can fix this in your browser" versus "this
 * machine can't do it", because only the first is worth a retry.
 */
function describeMediaError(err) {
  switch (err?.name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Camera and microphone access was blocked. You can allow it in your browser's site settings, or carry on in typing mode.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No camera or microphone was found on this device.";
    case "NotReadableError":
      return "Your camera or microphone is already in use by another app.";
    default:
      return "Couldn't start your camera and microphone.";
  }
}

/**
 * Ask for camera + mic once, up front, then hand the hardware straight back.
 *
 * The setup screen needs an answer to "will this work?" before the interview
 * starts, but it has no business holding the camera open while someone reads a
 * job description. Since the browser remembers the grant for the origin, the
 * chat screen's real `request()` a moment later reuses it without prompting
 * again — so the candidate sees exactly one permission dialog.
 *
 * @returns {Promise<{ ok: boolean, error: string }>}
 */
export async function probeMediaPermission() {
  if (!supportsMedia()) {
    return { ok: false, error: "This browser can't access a camera and microphone." };
  }
  try {
    const media = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    media.getTracks().forEach((t) => t.stop());
    return { ok: true, error: "" };
  } catch (err) {
    return { ok: false, error: describeMediaError(err) };
  }
}

export default function useDeliveryCapture() {
  const supported = supportsMedia();
  const [status, setStatus] = useState(
    supported ? PERMISSION_IDLE : PERMISSION_UNSUPPORTED
  );
  const [error, setError] = useState("");
  // Surfaced so the UI can be honest about eye contact being unavailable rather
  // than silently reporting nothing.
  const [faceTrackingReady, setFaceTrackingReady] = useState(false);

  const streamRef = useRef(null);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const bufferRef = useRef(null);
  const intervalRef = useRef(null);
  const trackerRef = useRef(createDeliveryTracker());
  const faceRef = useRef(null);
  const videoRef = useRef(null);
  const recordingRef = useRef(false);

  // Bumped by every release(). Anything in flight across a release checks this
  // before touching state — otherwise a getUserMedia resolving after teardown
  // reinstates a stream nobody can see and leaves the camera light on.
  const genRef = useRef(0);
  // Collapses overlapping request() calls onto one prompt, so StrictMode's
  // doubled effect doesn't open two streams and leak one. Keyed by generation:
  // an attempt started before a release() is worthless to a caller asking now —
  // it is already doomed to hand its tracks back — so a later request must start
  // a fresh one rather than await it. Sharing it regardless is what made Speak
  // mode fail every time in dev.
  const pendingRef = useRef(null); // { gen, promise } | null

  /** Attach the <video> the preview shows and the face tracker reads. */
  const attachVideo = useCallback((el) => {
    videoRef.current = el;
    if (el && streamRef.current && el.srcObject !== streamRef.current) {
      el.srcObject = streamRef.current;
      el.play?.().catch(() => {
        /* autoplay blocked — the preview just stays dark */
      });
    }
  }, []);

  const stopSampling = useCallback(() => {
    clearInterval(intervalRef.current);
    intervalRef.current = null;
  }, []);

  /**
   * Full teardown: tracks stopped, audio graph closed, model released, timers
   * cleared. Called on mode change, interview end, and unmount.
   */
  const release = useCallback(() => {
    genRef.current += 1;
    recordingRef.current = false;
    stopSampling();

    faceRef.current?.close();
    faceRef.current = null;
    setFaceTrackingReady(false);

    const ctx = audioCtxRef.current;
    audioCtxRef.current = null;
    analyserRef.current = null;
    bufferRef.current = null;
    if (ctx && ctx.state !== "closed") ctx.close().catch(() => {});

    const s = streamRef.current;
    streamRef.current = null;
    if (s) s.getTracks().forEach((t) => t.stop());

    if (videoRef.current) videoRef.current.srcObject = null;
    setStatus(supportsMedia() ? PERMISSION_IDLE : PERMISSION_UNSUPPORTED);
  }, [stopSampling]);

  // Last line of defence: whatever else happens, the camera goes off when the
  // owning component leaves the tree.
  useEffect(() => release, [release]);

  /**
   * Ask for camera + microphone. Resolves true on success, false on refusal —
   * callers use that to fall back to typing rather than to throw.
   */
  const request = useCallback(async () => {
    if (!supported) {
      setStatus(PERMISSION_UNSUPPORTED);
      setError("This browser can't access a camera and microphone.");
      return false;
    }
    if (streamRef.current) return true;

    const gen = genRef.current;
    // Only share an attempt that is still current.
    if (pendingRef.current && pendingRef.current.gen === gen) {
      return pendingRef.current.promise;
    }

    setStatus(PERMISSION_REQUESTING);
    setError("");

    const attempt = (async () => {
      let media;
      try {
        // Asked for together so the candidate sees one prompt, not two.
        media = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
        });
      } catch (err) {
        if (gen === genRef.current) {
          setStatus(PERMISSION_DENIED);
          setError(describeMediaError(err));
        }
        return false;
      }

      // Released while the prompt was open (screen left, mode switched): give
      // the hardware straight back instead of quietly holding it.
      if (gen !== genRef.current) {
        media.getTracks().forEach((t) => t.stop());
        return false;
      }

      streamRef.current = media;
      setStatus(PERMISSION_GRANTED);

      // Audio graph for loudness sampling. Nothing connects to the destination,
      // so this neither plays anything back nor records.
      try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        const ctx = new Ctx();
        const source = ctx.createMediaStreamSource(media);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0;
        source.connect(analyser);
        audioCtxRef.current = ctx;
        analyserRef.current = analyser;
        bufferRef.current = new Float32Array(analyser.fftSize);
      } catch (err) {
        // Pace and pauses are lost, but the interview is still perfectly usable.
        console.warn("[delivery] audio analysis unavailable:", err?.message);
      }

      if (videoRef.current) attachVideo(videoRef.current);

      // Eye contact is the optional extra: load it in the background so the
      // candidate isn't left staring at a spinner while ~7MB downloads. The
      // tracker resolves the <video> lazily, so it doesn't matter that the
      // preview may not have mounted yet.
      createFaceTracker(() => videoRef.current)
        .then((tracker) => {
          if (gen !== genRef.current) {
            tracker?.close(); // released while the model was loading
            return;
          }
          faceRef.current = tracker;
          setFaceTrackingReady(Boolean(tracker));
          // The candidate may already be answering by the time this lands.
          if (tracker && recordingRef.current) tracker.begin();
        })
        .catch(() => setFaceTrackingReady(false));

      return true;
    })();

    pendingRef.current = { gen, promise: attempt };
    try {
      return await attempt;
    } finally {
      // Don't clear a newer attempt that replaced this one.
      if (pendingRef.current?.promise === attempt) pendingRef.current = null;
    }
  }, [supported, attachVideo]);

  /** Start measuring a recording segment. Safe to call repeatedly. */
  const beginRecording = useCallback(() => {
    if (recordingRef.current) return;
    recordingRef.current = true;

    trackerRef.current.beginSegment();
    faceRef.current?.begin();

    const analyser = analyserRef.current;
    const buffer = bufferRef.current;
    if (!analyser || !buffer) return;

    audioCtxRef.current?.resume?.().catch(() => {});
    stopSampling();
    intervalRef.current = setInterval(() => {
      analyser.getFloatTimeDomainData(buffer);
      let sum = 0;
      for (let i = 0; i < buffer.length; i += 1) sum += buffer[i] * buffer[i];
      trackerRef.current.push(Math.sqrt(sum / buffer.length), performance.now());
    }, SAMPLE_INTERVAL_MS);
  }, [stopSampling]);

  /** Close the current segment. Counts are kept — an answer may span several. */
  const endRecording = useCallback(() => {
    if (!recordingRef.current) return;
    recordingRef.current = false;
    stopSampling();
    trackerRef.current.endSegment();
    faceRef.current?.end();
  }, [stopSampling]);

  /**
   * Finalise the answer: returns the metrics and resets for the next question.
   * @param {string} transcript  the submitted answer, for the word count.
   * @returns {{wpm: number|null, pauseCount: number|null, pauseMs: number|null,
   *   speakingMs: number|null, onCameraPct: number|null} | null}
   */
  const collect = useCallback(
    (transcript) => {
      endRecording();

      const audio = trackerRef.current.result(transcript);
      const onCameraPct = faceRef.current?.result() ?? null;
      trackerRef.current = createDeliveryTracker(); // fresh slate for the next answer

      const metrics = { ...audio, onCameraPct };
      // Nothing measurable: send no delivery field at all rather than a row of
      // nulls the evaluator would have to reason about.
      return Object.values(metrics).every((v) => v == null) ? null : metrics;
    },
    [endRecording]
  );

  return {
    supported,
    status,
    error,
    faceTrackingReady,
    granted: status === PERMISSION_GRANTED,
    request,
    release,
    attachVideo,
    beginRecording,
    endRecording,
    collect,
  };
}
