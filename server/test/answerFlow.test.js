import test from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.js";
import { submitAnswer } from "../src/controllers/interview.controller.js";
import {
  createSession,
  recordAnswer,
  recordQuestion,
  rollbackAnswer,
} from "../src/services/session.service.js";
import { runWithOwner, withModelBudget } from "../src/services/modelBudget.js";

const OWNER = "owner-12345678";
const JD = "Senior frontend engineer owning the design system and its tokens.";

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

async function answer(session, body) {
  const res = fakeRes();
  let error = null;
  await submitAnswer(
    { params: { sessionId: session.id }, clientId: OWNER, body },
    res,
    (err) => {
      error = err;
    }
  );
  return { res, error };
}

/** No API key = chatCompletion fails at once, like an upstream outage would. */
async function withModelDown(fn) {
  const saved = config.openRouter.apiKey;
  config.openRouter.apiKey = "";
  try {
    return await fn();
  } finally {
    config.openRouter.apiKey = saved;
  }
}

test("rollbackAnswer undoes exactly one recordAnswer", () => {
  const s = createSession(JD, OWNER, { totalQuestions: 3 });
  recordQuestion(s, "Q1?", 60);
  const before = JSON.stringify(s.messages);
  recordAnswer(s, "my answer", { wpm: 140 });
  rollbackAnswer(s);
  assert.equal(JSON.stringify(s.messages), before);
  assert.equal(s.qaPairs[0].answer, null);
  assert.equal(s.qaPairs[0].delivery, null);
});

test("a failed next-question call leaves the session as it was, so a retry isn't a duplicate turn", async () => {
  const s = createSession(JD, OWNER, { totalQuestions: 3 });
  recordQuestion(s, "Q1?", 60);
  const before = JSON.stringify({ m: s.messages, q: s.qaPairs });

  const { error } = await withModelDown(() => answer(s, { answer: "first try", questionNumber: 1 }));
  assert.ok(error, "the failure is passed on");
  assert.equal(JSON.stringify({ m: s.messages, q: s.qaPairs }), before);
  assert.equal(s.processing, false, "lock released");

  await withModelDown(() => answer(s, { answer: "second try", questionNumber: 1 }));
  const userTurns = s.messages.filter((m) => m.role === "user");
  assert.equal(userTurns.length, 0, "no answer piles up across failed attempts");
});

test("re-sending an answer the server already took replays the current question", async () => {
  const s = createSession(JD, OWNER, { totalQuestions: 3 });
  recordQuestion(s, "Q1?", 60);
  recordAnswer(s, "answer one");
  recordQuestion(s, "Q2?", 90);
  const before = JSON.stringify(s.messages);

  // The client never saw Q2 (its request timed out) and re-sends answer 1.
  const { res, error } = await answer(s, { answer: "answer one", questionNumber: 1 });
  assert.equal(error, null);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    question: "Q2?",
    questionNumber: 2,
    totalQuestions: 3,
    timeLimitSeconds: 90,
    done: false,
  });
  assert.equal(JSON.stringify(s.messages), before, "not recorded against question 2");
});

test("re-sending the final answer after the interview completed replays done", async () => {
  const s = createSession(JD, OWNER, { totalQuestions: 2 });
  recordQuestion(s, "Q1?", 60);
  recordAnswer(s, "a1");
  recordQuestion(s, "Q2?", 60);

  const first = await answer(s, { answer: "a2", questionNumber: 2 });
  assert.equal(first.res.body.done, true);
  const again = await answer(s, { answer: "a2", questionNumber: 2 });
  assert.equal(again.res.statusCode, 200);
  assert.equal(again.res.body.done, true);
});

test("an answer for a question that isn't current is refused", async () => {
  const s = createSession(JD, OWNER, { totalQuestions: 3 });
  recordQuestion(s, "Q1?", 60);
  const { res } = await answer(s, { answer: "x", questionNumber: 3 });
  assert.equal(res.statusCode, 409);
  const bad = await answer(s, { answer: "x", questionNumber: "one" });
  assert.equal(bad.res.statusCode, 400);
});

test("another owner's request can't release the session's processing lock", async () => {
  const s = createSession(JD, OWNER, { totalQuestions: 3 });
  recordQuestion(s, "Q1?", 60);
  s.processing = true; // the real owner's call is in flight
  let error = null;
  await submitAnswer(
    { params: { sessionId: s.id }, clientId: "someone-else-1", body: { answer: "x" } },
    fakeRes(),
    (err) => {
      error = err;
    }
  );
  assert.equal(error?.status, 404);
  assert.equal(s.processing, true, "lock still held by its owner");
});

test("each owner has their own daily model-call allowance", async () => {
  const saved = config.limits.modelCallsPerUserPerDay;
  config.limits.modelCallsPerUserPerDay = 2;
  try {
    const call = () => withModelBudget(async () => "ok", { kind: "progress" });
    await runWithOwner("owner-a-1234", async () => {
      assert.equal(await call(), "ok");
      assert.equal(await call(), "ok");
      await assert.rejects(call(), { status: 429 });
    });
    // A different owner is unaffected.
    await runWithOwner("owner-b-1234", async () => {
      assert.equal(await call(), "ok");
    });
  } finally {
    config.limits.modelCallsPerUserPerDay = saved;
  }
});
