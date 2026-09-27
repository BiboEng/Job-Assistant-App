import test from "node:test";
import assert from "node:assert/strict";
import {
  trendGeometry,
  nearestIndex,
  xLabelIndices,
  Y_TICKS,
} from "../src/utils/trendChart.js";

const box = { width: 440, height: 220, pad: { top: 20, right: 20, bottom: 40, left: 20 } };

test("y is fixed to 0-100, so small changes aren't exaggerated", () => {
  const g = trendGeometry([{ overallScore: 0 }, { overallScore: 100 }], box);
  assert.equal(g.coords[0].y, 180); // baseline: 220 - 40
  assert.equal(g.coords[1].y, 20); // top pad
  assert.deepEqual(g.ticks.map((t) => t.value), Y_TICKS);
});

test("points are evenly spaced by interview across the plot", () => {
  const g = trendGeometry(
    [{ overallScore: 50 }, { overallScore: 60 }, { overallScore: 70 }],
    box
  );
  assert.deepEqual(g.coords.map((c) => c.x), [20, 220, 420]);
  assert.match(g.line, /^M20,\d+(\.\d)? L220,/);
  assert.ok(g.area.endsWith("Z"));
});

test("a single point sits in the middle with no area wash", () => {
  const g = trendGeometry([{ overallScore: 70 }], box);
  assert.equal(g.coords[0].x, 220);
  assert.equal(g.area, "");
});

test("out-of-range and garbage scores are clamped", () => {
  const g = trendGeometry([{ overallScore: 250 }, { overallScore: "x" }], box);
  assert.equal(g.coords[0].y, 20);
  assert.equal(g.coords[1].y, 180);
});

test("nearestIndex snaps the crosshair to the closest interview", () => {
  const coords = [{ x: 20 }, { x: 220 }, { x: 420 }];
  assert.equal(nearestIndex(coords, 0), 0);
  assert.equal(nearestIndex(coords, 130), 1);
  assert.equal(nearestIndex(coords, 999), 2);
  assert.equal(nearestIndex([], 5), -1);
});

test("xLabelIndices keeps first and last and thins the rest to fit", () => {
  assert.deepEqual(xLabelIndices(0, 400), []);
  assert.deepEqual(xLabelIndices(1, 400), [0]);
  assert.deepEqual(xLabelIndices(3, 400), [0, 1, 2]);
  const thin = xLabelIndices(20, 200);
  assert.equal(thin[0], 0);
  assert.equal(thin[thin.length - 1], 19);
  assert.ok(thin.length <= 3);
});
