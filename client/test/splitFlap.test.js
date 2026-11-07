import test from "node:test";
import assert from "node:assert/strict";
import { FLAP_CHARS, toBoard, flapPath, flapFrames } from "../src/utils/splitFlap.js";

test("toBoard upper-cases, pads and truncates to the board width", () => {
  assert.equal(toBoard("nurse", 8), "NURSE   ");
  assert.equal(toBoard("frontend engineer", 8), "FRONTEND");
  assert.equal(toBoard("", 3), "   ");
  assert.equal(toBoard(null, 2), "  ");
});

test("toBoard shows characters the drum doesn't have as blanks", () => {
  assert.equal(toBoard("café!", 5), "CAF  ");
});

test("a tile only turns forward, ending on its target", () => {
  assert.deepEqual(flapPath("A", "C"), ["B", "C"]);
  // Backwards means all the way round the drum: capped, so the last six.
  const path = flapPath("C", "A");
  assert.equal(path.length, 6);
  assert.equal(path.at(-1), "A");
  const idx = path.map((ch) => FLAP_CHARS.indexOf(ch));
  for (let i = 1; i < idx.length; i += 1) {
    assert.equal(idx[i], (idx[i - 1] + 1) % FLAP_CHARS.length, "steps one drum slot at a time");
  }
});

test("a tile that doesn't change doesn't turn", () => {
  assert.deepEqual(flapPath("Q", "Q"), []);
});

test("maxSteps caps the rattle, and is never less than one turn", () => {
  assert.deepEqual(flapPath(" ", "Z", 3), ["X", "Y", "Z"]);
  assert.deepEqual(flapPath(" ", "Z", 0), ["Z"]);
});

test("frames end on the target line and keep the board width", () => {
  const frames = flapFrames("", "DATA ANALYST", { width: 17 });
  assert.equal(frames.at(-1), toBoard("DATA ANALYST", 17));
  for (const f of frames) assert.equal(f.length, 17);
});

test("tiles start one after another from the left", () => {
  const frames = flapFrames("  ", "AB", { width: 2, stagger: 1 });
  // Frame 1: only the first tile has moved.
  assert.notEqual(frames[0][0], " ");
  assert.equal(frames[0][1], " ");
});

test("the frame count is the slowest tile's start plus its turns", () => {
  // " "→"B" is 2 turns; " "→"A" is 1. Tile 1 starts a frame late: 1 + 1 = 2,
  // tile 0 finishes at 2 as well.
  assert.equal(flapFrames("  ", "BA", { width: 2, stagger: 1 }).length, 2);
});

test("nothing to change means no frames", () => {
  assert.deepEqual(flapFrames("NURSE", "nurse", { width: 5 }), []);
});
