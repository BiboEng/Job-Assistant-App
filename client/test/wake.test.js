import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  AWAKE_FOR_MS,
  _resetWake,
  ensureAwake,
  isWaking,
  markAwake,
  subscribeWaking,
} from "../src/api/wake.js";

beforeEach(() => _resetWake());

const ok = () => new Response("{}", { status: 200 });

test("a server that answered recently isn't pinged again", async () => {
  let calls = 0;
  const fetchImpl = async () => (calls++, ok());
  markAwake();
  await ensureAwake("", { fetchImpl });
  assert.equal(calls, 0);
});

test("concurrent requests share one health ping, then skip it", async () => {
  const urls = [];
  const fetchImpl = async (url) => (urls.push(url), ok());
  await Promise.all([
    ensureAwake("https://api.example", { fetchImpl }),
    ensureAwake("https://api.example", { fetchImpl }),
  ]);
  assert.deepEqual(urls, ["https://api.example/api/health"]);
  await ensureAwake("https://api.example", { fetchImpl });
  assert.equal(urls.length, 1);
});

test("after the awake window it checks again", async () => {
  let calls = 0;
  let clock = 1_000_000;
  const now = () => clock;
  const fetchImpl = async () => (calls++, ok());
  await ensureAwake("", { fetchImpl, now });
  clock += AWAKE_FOR_MS + 1;
  await ensureAwake("", { fetchImpl, now });
  assert.equal(calls, 2);
});

test("a 503 from the host while booting is retried until the server answers", async () => {
  const statuses = [503, 502, 200];
  const fetchImpl = async () => new Response("", { status: statuses.shift() });
  await ensureAwake("", { fetchImpl });
  assert.equal(statuses.length, 0);
});

test("an unreachable server doesn't block the request forever", async () => {
  const fetchImpl = async () => {
    throw new TypeError("Failed to fetch");
  };
  await ensureAwake("", { fetchImpl });
  assert.equal(isWaking(), false);
});

test("the notice shows only for a slow wake, and clears after", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const seen = [];
  subscribeWaking(() => seen.push(isWaking()));

  let answer;
  const fetchImpl = () => new Promise((resolve) => (answer = resolve));
  const done = ensureAwake("", { fetchImpl });

  t.mock.timers.tick(1000);
  assert.equal(isWaking(), false, "a quick wake shows nothing");
  t.mock.timers.tick(2000);
  assert.equal(isWaking(), true);

  answer(ok());
  await done;
  assert.equal(isWaking(), false);
  assert.deepEqual(seen, [true, false]);
});
