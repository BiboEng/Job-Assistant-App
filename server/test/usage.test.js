import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// usage.service reads DATA_DIR at import time.
const dir = await mkdtemp(join(tmpdir(), "mi-usage-"));
process.env.DATA_DIR = dir;
const {
  reserveUsage,
  usageFor,
  resetsAt,
  dayKey,
  _setUsageClock,
  _flushUsage,
  _resetUsageMemory,
} = await import("../src/services/usage.service.js");

test.after(async () => {
  await _flushUsage();
  await rm(dir, { recursive: true, force: true });
});

const DAY1 = Date.UTC(2026, 8, 30, 15, 0, 0);
const DAY2 = Date.UTC(2026, 9, 1, 0, 0, 1);

test("reserve counts up to the limit, then refuses", async () => {
  _setUsageClock(() => DAY1);
  const a = await reserveUsage("u-alice123", "interviews", 2);
  const b = await reserveUsage("u-alice123", "interviews", 2);
  const c = await reserveUsage("u-alice123", "interviews", 2);
  assert.deepEqual([a.ok, b.ok, c.ok], [true, true, false]);
  assert.equal(c.used, 2);
  assert.equal(c.limit, 2);
  assert.deepEqual(await usageFor("u-alice123"), { interviews: 2, jobSearches: 0, resumeMessages: 0 });
});

test("a refund gives the unit back, once", async () => {
  _setUsageClock(() => DAY1);
  const hold = await reserveUsage("u-bob12345", "jobSearches", 1);
  assert.equal(hold.ok, true);
  assert.equal((await reserveUsage("u-bob12345", "jobSearches", 1)).ok, false);
  hold.refund();
  hold.refund(); // no double refund
  assert.equal((await usageFor("u-bob12345")).jobSearches, 0);
  assert.equal((await reserveUsage("u-bob12345", "jobSearches", 1)).ok, true);
});

test("owners are counted separately, and a null limit counts nothing", async () => {
  _setUsageClock(() => DAY1);
  await reserveUsage("u-carol123", "resumeMessages", null);
  assert.equal((await usageFor("u-carol123")).resumeMessages, 0);
  assert.equal((await usageFor("u-dave1234")).interviews, 0);
});

test("counts reset at midnight UTC, and a refund can't reach back into yesterday", async () => {
  _setUsageClock(() => DAY1);
  const hold = await reserveUsage("u-erin1234", "interviews", 1);
  _setUsageClock(() => DAY2);
  assert.equal(dayKey(), "2026-10-01");
  assert.equal((await usageFor("u-erin1234")).interviews, 0);
  assert.equal((await reserveUsage("u-erin1234", "interviews", 1)).ok, true);
  hold.refund();
  assert.equal((await usageFor("u-erin1234")).interviews, 1);
});

test("resetsAt is the next 00:00 UTC", () => {
  assert.equal(resetsAt(DAY1), Date.UTC(2026, 9, 1));
});

test("counts survive a restart (they're written to usage.json)", async () => {
  _setUsageClock(() => DAY2);
  await reserveUsage("u-frank123", "jobSearches", 5);
  await reserveUsage("u-frank123", "jobSearches", 5);
  await _flushUsage();
  const saved = JSON.parse(await readFile(join(dir, "usage.json"), "utf8"));
  assert.equal(saved.counts["u-frank123"].jobSearches, 2);

  _resetUsageMemory(); // as after a restart
  assert.equal((await usageFor("u-frank123")).jobSearches, 2);
});

test("an unknown usage kind is a programming error", async () => {
  await assert.rejects(() => reserveUsage("u-x1234567", "tokens", 5), /Unknown usage kind/);
});
