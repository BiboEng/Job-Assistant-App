import test from "node:test";
import assert from "node:assert/strict";
import { RUBRIC_DIMENSIONS } from "../src/constants.js";
import { RUBRIC_KEYS } from "../../server/src/rubric.js";
import { rubricSeries, weakestDimension } from "../src/utils/rubric.js";

test("client rubric dimensions match the server's, in order", () => {
  assert.deepEqual(RUBRIC_DIMENSIONS.map((d) => d.key), RUBRIC_KEYS);
});

const it = (id, createdAt, rubric) => ({ id, createdAt, jobTitle: "Role", rubric });

test("interviews without a rubric are not points (never zeros)", () => {
  const { rated, dimensions } = rubricSeries([
    it("a", 1, null),
    it("b", 2, { relevance: 4, specificity: 3, structure: 5, depth: 2 }),
    it("c", 3, { relevance: 8, specificity: null, structure: 6, depth: 4 }),
  ]);
  assert.equal(rated, 2);
  const rel = dimensions.find((d) => d.key === "relevance");
  assert.deepEqual(rel.points.map((p) => p.id), ["b", "c"]);
  assert.equal(rel.latest, 8);
  assert.equal(rel.change, 4);
  assert.equal(rel.average, 6);
  const spec = dimensions.find((d) => d.key === "specificity");
  assert.deepEqual(spec.points.map((p) => p.value), [3]);
  assert.equal(spec.change, null, "one point is no trend");
});

test("values are clamped to 0-10 and junk is dropped", () => {
  const { dimensions } = rubricSeries([it("a", 1, { relevance: 14, depth: "x", structure: -2 })]);
  const by = Object.fromEntries(dimensions.map((d) => [d.key, d.latest]));
  assert.deepEqual(by, { relevance: 10, specificity: null, structure: 0, depth: null });
});

test("no interviews, or garbage, gives empty series", () => {
  const { rated, dimensions } = rubricSeries(null);
  assert.equal(rated, 0);
  assert.equal(dimensions.length, RUBRIC_DIMENSIONS.length);
  assert.ok(dimensions.every((d) => d.points.length === 0 && d.latest === null));
});

test("weakestDimension picks the lowest average, and nothing when all tie", () => {
  const { dimensions } = rubricSeries([
    it("a", 1, { relevance: 7, specificity: 3, structure: 6, depth: 5 }),
    it("b", 2, { relevance: 8, specificity: 5, structure: 6, depth: 4 }),
  ]);
  assert.equal(weakestDimension(dimensions).key, "specificity");
  const flat = rubricSeries([it("a", 1, { relevance: 5, specificity: 5, structure: 5, depth: 5 })]);
  assert.equal(weakestDimension(flat.dimensions), null);
  assert.equal(weakestDimension(rubricSeries([]).dimensions), null);
});
