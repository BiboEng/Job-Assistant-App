import test from "node:test";
import assert from "node:assert/strict";
import { MASCOT_ASCII, GREETING } from "../src/consoleGreeting.js";

test("the console mascot is plain ASCII, so it lines up in any console font", () => {
  for (const ch of MASCOT_ASCII) {
    const code = ch.codePointAt(0);
    assert.ok(code === 10 || (code >= 32 && code < 127), `non-ASCII character ${JSON.stringify(ch)}`);
  }
});

test("the greeting follows the site's copy rule: no em-dashes", () => {
  assert.ok(!GREETING.includes("—"));
});
