import { useCallback, useEffect, useRef, useState } from "react";

// Thin wrapper around the browser's Web Speech API (SpeechRecognition). Runs
// entirely client-side — no network call of our own, no API key. Not every
// browser ships it (Firefox notably doesn't), so callers must check `supported`
// and fall back to typing.
const SpeechRecognition =
  typeof window !== "undefined"
    ? window.SpeechRecognition || window.webkitSpeechRecognition
    : undefined;

const squash = (...parts) => parts.join(" ").replace(/\s+/g, " ").trim();

/**
 * @param {object} opts
 * @param {(text: string) => void} opts.onTranscript  called on every update with
 *   the full transcript of the CURRENT recording session (finalized text plus
 *   whatever is still being recognized). Reset each time `start()` is called.
 * @param {string} [opts.lang]  BCP-47 language tag; defaults to the document
 *   language or en-US.
 */
export default function useSpeechRecognition({ onTranscript, lang } = {}) {
  const supported = Boolean(SpeechRecognition);

  const [listening, setListening] = useState(false);
  const [error, setError] = useState("");
  // Set when the engine reports a fault the user can't fix by retrying (blocked
  // mic, no device, no route to the speech service). Callers should fall back to
  // typing when this is true.
  const [unavailable, setUnavailable] = useState(false);

  const recognitionRef = useRef(null);
  const onTranscriptRef = useRef(onTranscript);

  // Hard cap on a single continuous recording so the mic doesn't stay hot
  // indefinitely if the user walks away mid-answer.
  const MAX_SESSION_MS = 5 * 60 * 1000;
  const maxTimerRef = useRef(null);

  // True only while the user wants to keep recording. The engine fires `onend`
  // on its own after a pause / ~60s; we restart it unless the user asked to stop.
  const wantListeningRef = useRef(false);
  const restartTimerRef = useRef(null);

  // Chrome's first recognition request on a page often fails with "network" even
  // when the connection is fine; a retry usually succeeds. Give it a few goes
  // before falling back to typing.
  const NETWORK_RETRY_LIMIT = 3;
  const networkRetriesRef = useRef(0);

  // The engine restarts internally (and resets its result list) on every pause.
  // `committedRef` accumulates finalized text across those sub-sessions;
  // `sessionFinalRef` / `interimRef` hold the current sub-session, rebuilt from
  // scratch on each event so a re-delivered result never double-counts.
  const committedRef = useRef("");
  const sessionFinalRef = useRef("");
  const interimRef = useRef("");

  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

  useEffect(() => {
    if (!supported) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang =
      lang ||
      (typeof document !== "undefined" && document.documentElement.lang) ||
      "en-US";

    const emit = () => {
      onTranscriptRef.current?.(
        squash(committedRef.current, sessionFinalRef.current, interimRef.current)
      );
    };

    const restart = (delay = 0) => {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = setTimeout(() => {
        if (!wantListeningRef.current) return;
        try {
          recognition.start();
        } catch {
          // start() throws if the previous session is still tearing down; the
          // pending onend will call us again.
        }
      }, delay);
    };

    recognition.onresult = (event) => {
      networkRetriesRef.current = 0; // a result means the service is reachable
      let final = "";
      let interim = "";
      // event.results is cumulative for the sub-session — rebuild from the top
      // so replays of an already-seen result are idempotent.
      for (let i = 0; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result.isFinal) final += `${result[0].transcript} `;
        else interim += result[0].transcript;
      }
      sessionFinalRef.current = final.trim();
      interimRef.current = interim.trim();
      emit();
    };

    recognition.onerror = (event) => {
      // "no-speech" / "aborted" are routine and self-recover via onend.
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        setError("Microphone access is blocked — allow it in your browser's site settings, or type your answer below.");
        wantListeningRef.current = false;
        setUnavailable(true);
      } else if (event.error === "audio-capture") {
        setError("No microphone was found — type your answer below instead.");
        wantListeningRef.current = false;
        setUnavailable(true);
      } else if (event.error === "network") {
        networkRetriesRef.current += 1;
        if (networkRetriesRef.current > NETWORK_RETRY_LIMIT) {
          setError(
            "Can't reach the speech-recognition service. This usually means a VPN, network filter, or non-Google browser is blocking it — type your answer below instead."
          );
          wantListeningRef.current = false;
          setUnavailable(true);
        }
        // else: keep wantListeningRef true; onend schedules a delayed retry.
      }
    };

    recognition.onend = () => {
      // The engine drops un-finalized audio when it stops — fold everything from
      // this sub-session (interim included) into the committed transcript.
      committedRef.current = squash(
        committedRef.current,
        sessionFinalRef.current,
        interimRef.current
      );
      sessionFinalRef.current = "";
      interimRef.current = "";
      emit();

      if (wantListeningRef.current) {
        // Back off a bit while retrying past a network error, otherwise resume
        // promptly so a long answer isn't cut off at the engine's idle timeout.
        restart(networkRetriesRef.current > 0 ? 600 : 0);
        return;
      }
      setListening(false);
    };

    recognitionRef.current = recognition;

    return () => {
      wantListeningRef.current = false;
      clearTimeout(restartTimerRef.current);
      clearTimeout(maxTimerRef.current);
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      try {
        recognition.abort();
      } catch {
        /* already stopped */
      }
    };
  }, [supported, lang]);

  const start = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition || wantListeningRef.current) return;
    committedRef.current = "";
    sessionFinalRef.current = "";
    interimRef.current = "";
    networkRetriesRef.current = 0;
    setError("");
    setUnavailable(false);
    wantListeningRef.current = true;

    clearTimeout(maxTimerRef.current);
    maxTimerRef.current = setTimeout(() => {
      wantListeningRef.current = false;
      clearTimeout(restartTimerRef.current);
      try {
        recognition.stop();
      } catch {
        /* already stopped */
      }
      setListening(false);
      setError("Recording paused after a few minutes. Tap the mic to keep going.");
    }, MAX_SESSION_MS);

    try {
      recognition.start();
    } catch {
      // start() throws if it's mid-teardown from a previous session; onend
      // will resync the listening state.
    }
    setListening(true);
  }, []);

  const stop = useCallback(() => {
    const recognition = recognitionRef.current;
    wantListeningRef.current = false;
    clearTimeout(restartTimerRef.current);
    clearTimeout(maxTimerRef.current);
    if (recognition) {
      try {
        recognition.stop();
      } catch {
        /* already stopped */
      }
    }
    setListening(false);
  }, []);

  return { supported, listening, error, unavailable, start, stop };
}
