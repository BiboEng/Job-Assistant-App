import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeResume,
  emptyResume,
  isResumeEmpty,
  validateChatHistory,
  interpretModelTurn,
  RESUME_LIMITS,
} from "../src/services/resume.service.js";
import { config } from "../src/config.js";

test("emptyResume has every section and is reported empty", () => {
  const r = emptyResume();
  assert.deepEqual(Object.keys(r).sort(), [
    "certifications",
    "contact",
    "education",
    "experience",
    "projects",
    "skills",
    "summary",
  ]);
  assert.equal(isResumeEmpty(r), true);
});

test("normalizeResume coerces junk into a complete document", () => {
  for (const junk of [null, undefined, "resume", 42, []]) {
    const r = normalizeResume(junk);
    assert.equal(isResumeEmpty(r), true);
    assert.deepEqual(r.experience, []);
    assert.equal(r.contact.name, "");
  }
});

test("normalizeResume keeps good data and collapses whitespace in fields", () => {
  const r = normalizeResume({
    contact: { name: "  Ada   Lovelace \n", email: "ada@example.com" },
    summary: "Line one.\n\n\n\nLine two.",
    experience: [
      {
        id: "exp-1",
        role: "Engineer",
        company: "Analytical Co",
        bullets: ["Built   the   thing", "", "   ", "Shipped it"],
      },
    ],
  });

  assert.equal(r.contact.name, "Ada Lovelace");
  assert.equal(r.summary, "Line one.\n\nLine two."); // paragraph breaks survive
  assert.equal(r.experience[0].id, "exp-1"); // ids round-trip
  assert.deepEqual(r.experience[0].bullets, ["Built the thing", "Shipped it"]);
});

test("normalizeResume mints ids for entries that lack them", () => {
  const r = normalizeResume({
    experience: [{ role: "Engineer" }],
    education: [{ school: "MIT" }],
  });
  assert.match(r.experience[0].id, /^exp-/);
  assert.match(r.education[0].id, /^edu-/);
});

test("normalizeResume accepts the field aliases a model tends to emit", () => {
  const r = normalizeResume({
    experience: [{ title: "Engineer", employer: "Acme" }],
    education: [{ institution: "MIT", degree: "BSc" }],
    skills: [{ name: "Languages", items: ["Go"] }],
    projects: [{ title: "Loom", url: "https://example.com" }],
  });
  assert.equal(r.experience[0].role, "Engineer");
  assert.equal(r.experience[0].company, "Acme");
  assert.equal(r.education[0].school, "MIT");
  assert.equal(r.skills[0].category, "Languages");
  assert.equal(r.projects[0].name, "Loom");
  assert.equal(r.projects[0].link, "https://example.com");
});

test("normalizeResume tolerates bare-string contact links", () => {
  const r = normalizeResume({
    contact: { links: ["https://example.com", { label: "GitHub", url: "https://gh" }] },
  });
  assert.deepEqual(r.contact.links, [
    { label: "https://example.com", url: "https://example.com" },
    { label: "GitHub", url: "https://gh" },
  ]);
});

test("normalizeResume drops entries with no substance", () => {
  const r = normalizeResume({
    experience: [{ role: "", company: "", bullets: [] }, { role: "Engineer" }],
    education: [{}, { school: "MIT" }],
    certifications: [{ issuer: "AWS" }, { name: "SAA" }],
  });
  assert.equal(r.experience.length, 1);
  assert.equal(r.education.length, 1);
  assert.equal(r.certifications.length, 1);
});

test("normalizeResume enforces the count and length caps", () => {
  const many = (n, make) => Array.from({ length: n }, (_, i) => make(i));
  const r = normalizeResume({
    contact: { name: "x".repeat(500) },
    summary: "y".repeat(5000),
    experience: many(50, (i) => ({
      role: `Role ${i}`,
      bullets: many(50, () => "z".repeat(1000)),
    })),
    skills: many(50, (i) => ({ category: `c${i}`, items: many(100, (j) => `s${j}`) })),
  });

  assert.equal(r.contact.name.length, RESUME_LIMITS.short);
  assert.equal(r.summary.length, RESUME_LIMITS.summary);
  assert.equal(r.experience.length, RESUME_LIMITS.maxExperience);
  assert.equal(r.experience[0].bullets.length, RESUME_LIMITS.maxBullets);
  assert.equal(r.experience[0].bullets[0].length, RESUME_LIMITS.bullet);
  assert.equal(r.skills.length, RESUME_LIMITS.maxSkillGroups);
  assert.equal(r.skills[0].items.length, RESUME_LIMITS.maxSkillItems);
});

test("normalized output is stable under a second pass", () => {
  const once = normalizeResume({
    contact: { name: "Ada", links: ["https://x"] },
    summary: "A summary.",
    experience: [{ role: "Engineer", company: "Acme", bullets: ["Did work"] }],
  });
  assert.deepEqual(normalizeResume(once), once);
});

test("isResumeEmpty is false as soon as anything is filled in", () => {
  assert.equal(isResumeEmpty(normalizeResume({ summary: "hi" })), false);
  assert.equal(isResumeEmpty(normalizeResume({ contact: { name: "Ada" } })), false);
  assert.equal(
    isResumeEmpty(normalizeResume({ experience: [{ role: "Engineer" }] })),
    false
  );
});

test("validateChatHistory rejects empty or non-array input", () => {
  assert.ok(validateChatHistory(null).error);
  assert.ok(validateChatHistory([]).error);
  assert.ok(validateChatHistory([{ role: "user", content: "   " }]).error);
});

test("validateChatHistory requires the last message to be the user's", () => {
  const out = validateChatHistory([
    { role: "user", content: "hi" },
    { role: "assistant", content: "hello" },
  ]);
  assert.ok(out.error);
});

test("validateChatHistory normalizes roles and keeps only the last N turns", () => {
  const raw = Array.from({ length: 40 }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: `m${i}`,
  }));
  raw.push({ role: "user", content: "latest" });

  const { messages, error } = validateChatHistory(raw);
  assert.equal(error, undefined);
  assert.equal(messages.length, config.resume.maxHistoryMessages);
  assert.equal(messages[messages.length - 1].content, "latest");
  for (const m of messages) assert.ok(m.role === "user" || m.role === "assistant");
});

test("validateChatHistory truncates over-long messages", () => {
  const { messages } = validateChatHistory([
    { role: "user", content: "x".repeat(50_000) },
  ]);
  assert.equal(messages[0].content.length, config.resume.maxMessageLength);
});

test("interpretModelTurn reads the intended { reply, resume } envelope", () => {
  const out = interpretModelTurn({
    reply: "  Added your role.  ",
    resume: { contact: { name: "Ada" } },
  });
  assert.equal(out.reply, "Added your role.");
  assert.deepEqual(out.resume, { contact: { name: "Ada" } });
});

test("interpretModelTurn treats an explicit null resume as 'nothing changed'", () => {
  const out = interpretModelTurn({ reply: "What city?", resume: null });
  assert.equal(out.reply, "What city?");
  assert.equal(out.resume, null);
});

test("interpretModelTurn recovers a bare resume when the model drops the envelope", () => {
  // Observed with inclusionai/ling-3.0-flash-fin:free — it returns the document
  // itself with no wrapper. Discarding that would lose the whole turn.
  const bare = {
    contact: { name: "Ada Lovelace" },
    summary: "Backend engineer.",
    experience: [{ role: "Backend Engineer" }],
    education: [],
    skills: [],
    projects: [],
    certifications: [],
  };
  const out = interpretModelTurn(bare);
  assert.equal(out.reply, "");
  assert.equal(out.resume, bare);
  assert.equal(normalizeResume(out.resume).contact.name, "Ada Lovelace");
});

test("interpretModelTurn handles a flattened document that still carries a reply", () => {
  const out = interpretModelTurn({
    reply: "Tightened your summary.",
    summary: "Shorter.",
    experience: [],
  });
  assert.equal(out.reply, "Tightened your summary.");
  assert.equal(out.resume.summary, "Shorter.");
});

test("interpretModelTurn leaves the document alone for a reply-only turn", () => {
  const out = interpretModelTurn({ reply: "Which role should I tailor for?" });
  assert.equal(out.resume, null);
});

test("interpretModelTurn never throws on junk", () => {
  for (const junk of [null, undefined, "text", 7, [], { resume: "nope" }]) {
    const out = interpretModelTurn(junk);
    assert.equal(typeof out.reply, "string");
    assert.equal(out.resume, null);
  }
});

test("resume chat payload caps fit inside the express body limit", () => {
  const { maxHistoryMessages, maxMessageLength, maxResumeJsonLength } = config.resume;
  const worstCase = maxHistoryMessages * maxMessageLength + maxResumeJsonLength;
  assert.ok(
    worstCase < 64 * 1024,
    `worst-case resume chat body ${worstCase} exceeds the 64kb express.json limit`
  );
});
