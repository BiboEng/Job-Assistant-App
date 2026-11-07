/**
 * Split-flap board logic, pure so it can be tested under plain node.
 *
 * A real split-flap tile can only turn forward through a fixed drum of
 * characters, so changing "A" to "C" shows "B" on the way past. This module
 * works out every intermediate board state (a "frame") for a change from one
 * line of text to another; components/SplitFlap.jsx just plays the frames.
 *
 * Two liberties with the physics, both so a change reads as a quick rattle
 * rather than a long wait: a tile turns at most `maxSteps` times (it jumps to
 * the last few characters before its target), and tiles start one after
 * another from the left (`stagger` frames apart), like a board updating.
 */

/** The drum: what one tile can show, in the order it turns through them. */
export const FLAP_CHARS = " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789&'-./";

/** Text → exactly `width` drum characters: upper-cased, unknowns as blanks. */
export function toBoard(text, width) {
  const upper = String(text ?? "").toUpperCase();
  let out = "";
  for (const ch of upper) out += FLAP_CHARS.includes(ch) ? ch : " ";
  return out.slice(0, width).padEnd(width, " ");
}

/**
 * The characters one tile shows on its way from `from` to `to`, ending on
 * `to`. Forward through the drum only (wrapping round the end), at most
 * `maxSteps` of them. Empty when the tile doesn't change.
 */
export function flapPath(from, to, maxSteps = 6) {
  const a = FLAP_CHARS.indexOf(from);
  const b = FLAP_CHARS.indexOf(to);
  if (a === b) return [];
  if (a === -1 || b === -1) return [to];
  const n = FLAP_CHARS.length;
  const distance = (b - a + n) % n;
  const steps = Math.min(distance, Math.max(1, maxSteps));
  const path = [];
  for (let s = steps - 1; s >= 0; s -= 1) path.push(FLAP_CHARS[(b - s + n) % n]);
  return path;
}

/**
 * Every board state between `fromText` and `toText`, in order, not including
 * the starting state. The last frame is always `toText` as a board line; no
 * frames at all when nothing changes.
 */
export function flapFrames(fromText, toText, { width, maxSteps = 6, stagger = 1 } = {}) {
  const w = width ?? Math.max(String(fromText).length, String(toText).length);
  const from = toBoard(fromText, w);
  const to = toBoard(toText, w);
  const paths = [...to].map((ch, i) => flapPath(from[i], ch, maxSteps));

  let total = 0;
  paths.forEach((path, i) => {
    if (path.length) total = Math.max(total, i * stagger + path.length);
  });

  const frames = [];
  for (let k = 1; k <= total; k += 1) {
    let row = "";
    for (let i = 0; i < w; i += 1) {
      const taken = Math.min(Math.max(k - i * stagger, 0), paths[i].length);
      row += taken === 0 ? from[i] : paths[i][taken - 1];
    }
    frames.push(row);
  }
  return frames;
}
