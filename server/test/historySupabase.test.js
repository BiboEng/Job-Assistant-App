import test from "node:test";
import assert from "node:assert/strict";

// config reads the environment at import time, so set it before loading.
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_test";
delete process.env.HISTORY_STORE;

const { _setSupabaseFetch } = await import("../src/services/supabaseAdmin.js");
const history = await import("../src/services/history.supabase.js");
const { buildRecord, ownerUserId, recordToRow, rowToRecord } = await import(
  "../src/services/historyRecord.js"
);

const OWNER = "u-0123456789abcdef0123456789abcdef";
const OTHER = "u-ffffffffffffffffffffffffffffffff";

/**
 * A small stand-in for PostgREST over one table: enough of eq / in filters,
 * order, limit, offset and select to exercise the store for real.
 */
function fakePostgrest() {
  const rows = [];
  const calls = [];

  function matches(row, params) {
    for (const [key, value] of params) {
      if (["select", "order", "limit", "offset", "on_conflict"].includes(key)) continue;
      if (value.startsWith("eq.")) {
        if (String(row[key]) !== decodeURIComponent(value.slice(3))) return false;
      } else if (value.startsWith("in.(")) {
        if (!value.slice(4, -1).split(",").includes(String(row[key]))) return false;
      }
    }
    return true;
  }

  async function fetchImpl(url, init) {
    const u = new URL(url);
    const params = [...u.searchParams];
    const get = (k) => u.searchParams.get(k);
    calls.push({ method: init.method, url: u.pathname + u.search, headers: init.headers });
    assert.equal(init.headers.apikey, "sb_secret_test");
    assert.ok(u.pathname.endsWith("/rest/v1/interview_history"));

    let body = null;
    if (init.method === "POST") {
      const incoming = JSON.parse(init.body);
      for (const row of Array.isArray(incoming) ? incoming : [incoming]) rows.push(row);
    } else if (init.method === "DELETE") {
      const gone = rows.filter((r) => matches(r, params));
      for (const r of gone) rows.splice(rows.indexOf(r), 1);
      body = gone;
    } else if (init.method === "PATCH") {
      const hit = rows.filter((r) => matches(r, params));
      for (const r of hit) Object.assign(r, JSON.parse(init.body));
      body = hit;
    } else {
      let out = rows.filter((r) => matches(r, params));
      const order = get("order");
      if (order) {
        const [col, dir] = order.split(".");
        out.sort((a, b) => (a[col] < b[col] ? -1 : 1) * (dir === "desc" ? -1 : 1));
      }
      out = out.slice(Number(get("offset") || 0));
      if (get("limit")) out = out.slice(0, Number(get("limit")));
      body = out.map((r) => {
        const sel = get("select");
        if (!sel || sel === "*") return r;
        const picked = {};
        for (const part of sel.split(",")) {
          const [alias, path] = part.includes(":") ? part.split(":") : [part, part];
          const [col, key] = path.split("->");
          picked[alias] = key ? r[col]?.[key] : r[col];
        }
        return picked;
      });
    }
    const prefersMinimal = /return=minimal/.test(init.headers.Prefer || "");
    return new Response(prefersMinimal || body == null ? "" : JSON.stringify(body), {
      status: 200,
    });
  }

  return { rows, calls, fetchImpl };
}

function input(overrides = {}) {
  return {
    ownerId: OWNER,
    jobDescription: "Frontend Engineer\nBuild accessible UIs in React.",
    totalQuestions: 2,
    mode: "type",
    focus: "mixed",
    qaPairs: [
      { questionNumber: 1, question: "Q1?", answer: "A1", timeLimitSeconds: 60 },
      { questionNumber: 2, question: "Q2?", answer: "", timeLimitSeconds: 60 },
    ],
    feedback: { overallScore: 72, summary: "Solid." },
    ...overrides,
  };
}

test("ownerUserId turns a signed-in owner back into its Supabase user id", () => {
  assert.equal(ownerUserId(OWNER), "01234567-89ab-cdef-0123-456789abcdef");
  assert.equal(ownerUserId("browser-1234abcd"), null);
  assert.equal(ownerUserId(null), null);
});

test("a record survives the trip to a row and back", () => {
  const record = { ...buildRecord(input()), role: { title: "Frontend Engineer", source: "model", labelledAt: 1 } };
  const back = rowToRecord(recordToRow(record));
  assert.deepEqual(back, record);
});

test("save, list, open, label and delete go through owner-scoped queries", async () => {
  const pg = fakePostgrest();
  _setSupabaseFetch(pg.fetchImpl);

  const first = await history.saveInterview(input());
  await new Promise((r) => setTimeout(r, 5));
  const second = await history.saveInterview(input({ feedback: { overallScore: 88 } }));
  await history.saveInterview(input({ ownerId: OTHER }));

  assert.equal(pg.rows[0].user_id, "01234567-89ab-cdef-0123-456789abcdef");

  const list = await history.listInterviews(OWNER);
  assert.deepEqual(list.map((r) => r.id), [second.id, first.id]);
  assert.equal(list[0].overallScore, 88);
  assert.equal(list[1].title, "Frontend Engineer");
  assert.equal(list[1].answeredCount, 1);

  assert.deepEqual((await history.listInterviews(OWNER, { limit: 1 })).map((r) => r.id), [second.id]);
  assert.equal(await history.countInterviews(OWNER), 2);
  assert.equal(await history.isWithinNewest(first.id, OWNER, 1), false);
  assert.equal(await history.isWithinNewest(second.id, OWNER, 1), true);

  const opened = await history.getInterview(first.id, OWNER);
  assert.equal(opened.feedback.summary, "Solid.");
  assert.equal(await history.getInterview(first.id, OTHER), null, "another owner can't open it");

  const labelled = await history.setInterviewRoles(
    OWNER,
    new Map([[first.id, { title: "Frontend Engineer", source: "model", labelledAt: 5 }]])
  );
  assert.equal(labelled, 1);
  const records = await history.listOwnerRecords(OWNER);
  assert.deepEqual(records.map((r) => r.id), [first.id, second.id], "oldest first");
  assert.equal(records[0].role.title, "Frontend Engineer");

  assert.equal(await history.deleteInterview(first.id, OTHER), false);
  assert.equal(await history.deleteInterview(first.id, OWNER), true);
  assert.equal(await history.countInterviews(OWNER), 1);

  // Every query that reads or changes rows names the owner.
  for (const call of pg.calls) {
    if (call.method === "POST") continue;
    assert.match(call.url, /owner_id=eq\./, `${call.method} ${call.url}`);
  }
});

test("bad ids and owners never reach the database", async () => {
  const pg = fakePostgrest();
  _setSupabaseFetch(pg.fetchImpl);
  assert.equal(await history.getInterview("not-a-uuid", OWNER), null);
  assert.equal(await history.getInterview("01234567-89ab-cdef-0123-456789abcdef", "a&b=c"), null);
  assert.deepEqual(await history.listInterviews(""), []);
  assert.equal(await history.deleteInterview("x", OWNER), false);
  assert.equal(pg.calls.length, 0);
});

test("a missing table is reported as such, so the server can fall back", async () => {
  _setSupabaseFetch(
    async () =>
      new Response(JSON.stringify({ code: "PGRST205", message: "Could not find the table" }), {
        status: 404,
      })
  );
  await assert.rejects(history.ready(), (err) => err.missingTable === true);
  _setSupabaseFetch(null);
});
