import { useCallback, useEffect, useRef, useState } from "react";
import { flapFrames, toBoard } from "../utils/splitFlap.js";
import styles from "./SplitFlap.module.css";

/**
 * A split-flap ("departures board") line. It starts blank, and the first
 * time it scrolls into view it turns through `sequence` once, holding each
 * entry for `hold` ms, and settles on the last. Never a loop.
 *
 * The parent can also drive it: whenever `value` changes, the board turns
 * from whatever it shows to the new value, cutting the intro short if it's
 * still running (the hero's "Try a question" buttons).
 *
 * Decorative: the whole board is aria-hidden, so the caller supplies any text
 * a screen reader needs. Reduced motion (or no IntersectionObserver) shows
 * the end state straight away. Switching tabs mid-run skips to the end rather
 * than leaving a half-turned board behind.
 *
 * Each tile is keyed on its character, so a tile remounts, and its flip
 * animation runs, only when its character changes, and only while playing.
 *
 * `accent` inks every tile mint; `settleAccent` only while the board is at
 * rest (the hero's "YOUR NEXT JOB", or a role a visitor picked).
 */

const TICK_MS = 60;

function prefersReducedMotion() {
  return Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

export default function SplitFlap({
  sequence,
  value = null,
  width,
  hold = 1300,
  delay = 0,
  size = "md",
  accent = false,
  settleAccent = false,
  className = "",
}) {
  const w = width ?? Math.max(...sequence.map((s) => s.length));
  // Callers usually pass an array literal; key the effects on its contents,
  // not its identity, so a re-render can't restart the board mid-play.
  const seqKey = sequence.join("\u0000");
  const sequenceRef = useRef(sequence);
  sequenceRef.current = sequence;

  const [board, setBoard] = useState(() => toBoard("", w));
  const [playing, setPlaying] = useState(false);
  const [settled, setSettled] = useState(false);
  const rootRef = useRef(null);
  const timerRef = useRef(0);
  const boardRef = useRef(board);
  const playingRef = useRef(false);
  // Where the current (or last) run ends, so a skip knows where to land.
  const targetRef = useRef(sequence.at(-1) ?? "");

  const show = useCallback((line) => {
    boardRef.current = line;
    setBoard(line);
  }, []);

  const setRunning = useCallback((running) => {
    playingRef.current = running;
    setPlaying(running);
    setSettled(!running);
  }, []);

  const finish = useCallback(() => {
    window.clearTimeout(timerRef.current);
    show(toBoard(targetRef.current, w));
    setRunning(false);
  }, [w, show, setRunning]);

  /** Turn through `lines` in order, from whatever the board shows now. */
  const play = useCallback(
    (lines, startDelay = 0) => {
      window.clearTimeout(timerRef.current);
      targetRef.current = lines.at(-1) ?? "";
      if (prefersReducedMotion()) {
        finish();
        return;
      }
      playingRef.current = true;
      setPlaying(true);
      setSettled(false);
      let from = boardRef.current;
      let step = 0;
      let frames = [];

      // One entry at a time: compute its frames from whatever is showing,
      // play them a tick apart, hold, then on to the next.
      const nextEntry = () => {
        if (step >= lines.length) {
          setRunning(false);
          return;
        }
        frames = flapFrames(from, lines[step], { width: w });
        from = toBoard(lines[step], w);
        step += 1;
        playFrame(0);
      };
      const playFrame = (i) => {
        if (i >= frames.length) {
          timerRef.current = window.setTimeout(nextEntry, step >= lines.length ? 0 : hold);
          return;
        }
        show(frames[i]);
        timerRef.current = window.setTimeout(() => playFrame(i + 1), TICK_MS);
      };
      timerRef.current = window.setTimeout(nextEntry, startDelay);
    },
    [w, hold, show, setRunning, finish]
  );

  // The intro: the first time the board is (mostly) on screen.
  useEffect(() => {
    const el = rootRef.current;
    if (!el || prefersReducedMotion() || typeof IntersectionObserver === "undefined") {
      targetRef.current = sequenceRef.current.at(-1) ?? "";
      finish();
      return undefined;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          play(sequenceRef.current, delay);
        }
      },
      { threshold: 0.6 }
    );
    io.observe(el);
    return () => {
      io.disconnect();
      window.clearTimeout(timerRef.current);
    };
  }, [seqKey, play, finish, delay]);

  // Driven: turn to each new `value` (cutting the intro short if need be).
  const lastValueRef = useRef(value);
  useEffect(() => {
    if (value === lastValueRef.current) return;
    lastValueRef.current = value;
    if (value != null) play([value]);
  }, [value, play]);

  // A hidden tab throttles timers to a crawl; skip to the end instead.
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden && playingRef.current) finish();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [finish]);

  // Fidget: at rest, a mouse passing over a tile turns it over once, like a
  // finger run along a real board. Bumping the tile's count changes its key,
  // so it remounts and its flip animation runs again. Mouse only: on touch
  // there's no "passing over", and a tap would just look like a glitch.
  const [nudges, setNudges] = useState(() => new Array(w).fill(0));
  const fidget = (i) => (e) => {
    if (e.pointerType !== "mouse" || playingRef.current || prefersReducedMotion()) return;
    setNudges((n) => n.map((v, j) => (j === i ? v + 1 : v)));
  };

  return (
    <span
      ref={rootRef}
      aria-hidden="true"
      className={[
        styles.board,
        size === "sm" ? styles.sm : "",
        accent || (settleAccent && settled) ? styles.accent : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      data-playing={playing ? "" : undefined}
    >
      {[...board].map((ch, i) => (
        <span
          key={`${i}:${ch}:${nudges[i] ?? 0}`}
          className={`${styles.tile} ${nudges[i] ? styles.nudged : ""}`}
          onPointerEnter={fidget(i)}
        >
          <span className={styles.top}>
            <span className={styles.face}>{ch}</span>
          </span>
          <span className={styles.bottom}>
            <span className={styles.face}>{ch}</span>
          </span>
        </span>
      ))}
    </span>
  );
}
