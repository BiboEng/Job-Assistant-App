import test from "node:test";
import assert from "node:assert/strict";
import {
  clampQuestions,
  createSession,
  recordQuestion,
  recordAnswer,
} from "../src/services/session.service.js";
import { interviewerSystemPrompt } from "../src/prompts/index.js";
import { config } from "../src/config.js";

test("clampQuestions holds the configured range and defaults on junk", () => {
  assert.equal(clampQuestions(1), config.minQuestions);
  assert.equal(clampQuestions(99), config.maxQuestions);
  assert.equal(clampQuestions(4), 4);
  assert.equal(clampQuestions("abc"), config.totalQuestions);
  assert.equal(clampQuestions(undefined), config.totalQuestions);
});

test("interviewerSystemPrompt reflects question count and focus", () => {
  const p = interviewerSystemPrompt("Build things", {
    totalQuestions: 5,
    focus: "system-design",
  });
  assert.match(p, /total of 5 questions/);
  assert.match(p, /design and architecture/i);
});

test("interviewerSystemPrompt embeds the resume only when given", () => {
  assert.doesNotMatch(interviewerSystemPrompt("JD"), /RESUME START/);
  assert.match(
    interviewerSystemPrompt("JD", { resumeText: "10 years of Rust" }),
    /RESUME START[\s\S]*10 years of Rust/
  );
});

test("createSession defaults to type mode and accepts speak", () => {
  const jd = "A job description long enough to be realistic.";
  assert.equal(createSession(jd, "owner").mode, "type");
  assert.equal(createSession(jd, "owner", { mode: "speak" }).mode, "speak");
  // Unknown values fall back rather than throwing — the controller rejects
  // them first, so this is the second line of defence.
  assert.equal(createSession(jd, "owner", { mode: "telepathy" }).mode, "type");
});

test("delivery metrics attach to the answered pair, never to the model transcript", () => {
  const session = createSession("A job description.", "owner", { mode: "speak" });
  recordQuestion(session, "Tell me about yourself.", 120);
  assert.equal(session.qaPairs[0].delivery, null);

  const delivery = { wpm: 150, pauseCount: 2, pauseMs: 4000, speakingMs: 30000, onCameraPct: 80 };
  recordAnswer(session, "I build things.", delivery);
  assert.deepEqual(session.qaPairs[0].delivery, delivery);

  // The interviewer's own context stays clean: it asks the next question from
  // the answer alone, with no delivery numbers to react to.
  const forModel = session.messages.map((m) => m.content).join("\n");
  assert.doesNotMatch(forModel, /wpm|onCamera|pause/i);
});

test("recordAnswer without delivery leaves the slot null", () => {
  const session = createSession("A job description.", "owner");
  recordQuestion(session, "Q?", 60);
  recordAnswer(session, "A.");
  assert.equal(session.qaPairs[0].delivery, null);
});
