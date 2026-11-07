import test from "node:test";
import assert from "node:assert/strict";
import {
  SAMPLE_ROLES,
  BOARD_INTRO,
  BOARD_FINALE,
  BOARD_WIDTH,
  MASCOT_CLICKS,
} from "../src/screens/landingSamples.js";
import { FLAP_CHARS } from "../src/utils/splitFlap.js";

const allCopy = () => [
  ...SAMPLE_ROLES.flatMap((r) => [r.label, ...r.questions]),
  ...MASCOT_CLICKS.map((c) => c.line),
];

test("every board line fits the board and uses only characters it can show", () => {
  for (const line of BOARD_INTRO) {
    assert.ok(line.length <= BOARD_WIDTH, `"${line}" is wider than ${BOARD_WIDTH} tiles`);
    for (const ch of line) assert.ok(FLAP_CHARS.includes(ch), `"${line}" has "${ch}"`);
  }
  assert.equal(BOARD_INTRO.at(-1), BOARD_FINALE);
});

test("each role's board line is its label, upper-cased", () => {
  for (const r of SAMPLE_ROLES) assert.equal(r.board, r.label.toUpperCase());
});

test("each role has two or three questions, short enough for the bubble", () => {
  const ids = new Set();
  for (const r of SAMPLE_ROLES) {
    assert.ok(!ids.has(r.id), `duplicate id ${r.id}`);
    ids.add(r.id);
    assert.ok(r.questions.length >= 2 && r.questions.length <= 3, r.id);
    for (const q of r.questions) assert.ok(q.length <= 100, `too long for the bubble: ${q}`);
  }
});

test("the copy follows the landing page's rule: no em- or en-dashes", () => {
  for (const text of allCopy()) assert.ok(!/[–—]/.test(text), text);
});

test("the mascot's click steps only use poses that exist", () => {
  const poses = new Set(["welcome", "interviewing", "thinking", "feedback", "celebrate", "positive"]);
  for (const c of MASCOT_CLICKS) assert.ok(poses.has(c.pose), c.pose);
});
