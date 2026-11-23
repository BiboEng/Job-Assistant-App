import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NETWORK_MESSAGE,
  SIGNED_OUT_MESSAGE,
  TIMEOUT_MESSAGE,
  responseMessage,
  statusMessage,
  supabaseMessage,
} from "../src/api/errors.js";

test("a server's own error wins, except on a 401", () => {
  assert.equal(responseMessage(400, { error: "Paste a job description." }), "Paste a job description.");
  assert.equal(responseMessage(401, { error: "Malformed token." }), SIGNED_OUT_MESSAGE);
});

test("a response with no readable error never shows a status code", () => {
  for (const status of [400, 403, 404, 408, 413, 429, 500, 502, 503, 504]) {
    const msg = responseMessage(status, null);
    assert.ok(msg.length > 10, `status ${status}`);
    assert.doesNotMatch(msg, /\d{3}|request failed/i, `status ${status}`);
  }
  assert.equal(responseMessage(502, { error: "   " }), statusMessage(502));
  assert.equal(statusMessage(504), TIMEOUT_MESSAGE);
});

test("Supabase's internal wording is replaced", () => {
  const fallback = "Couldn't save that change.";
  assert.equal(
    supabaseMessage({ message: 'new row violates check constraint "x"', code: "23514" }, fallback),
    fallback
  );
  assert.equal(supabaseMessage({ message: "TypeError: Failed to fetch" }, fallback), NETWORK_MESSAGE);
  assert.equal(supabaseMessage({ message: "JWT expired", code: "PGRST301" }, fallback), SIGNED_OUT_MESSAGE);
  assert.equal(supabaseMessage(null, fallback), fallback);
});
