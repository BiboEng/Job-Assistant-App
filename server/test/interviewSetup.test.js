import test from "node:test";
import assert from "node:assert/strict";
import { clampQuestions } from "../src/services/session.service.js";
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
