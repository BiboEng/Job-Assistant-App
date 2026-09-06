import test from "node:test";
import assert from "node:assert/strict";
import { parseJsonLoose } from "../src/services/openrouter.service.js";

test("parses a bare JSON object", () => {
  assert.deepEqual(parseJsonLoose('{"a":1}'), { a: 1 });
});

test("strips ```json code fences", () => {
  assert.deepEqual(parseJsonLoose('```json\n{"a":1}\n```'), { a: 1 });
});

test("ignores prose around the object", () => {
  assert.deepEqual(
    parseJsonLoose('Sure! Here is the JSON:\n{"score": 7}\nHope that helps.'),
    { score: 7 }
  );
});

test("throws when there is no object", () => {
  assert.throws(() => parseJsonLoose("no json here"));
});
