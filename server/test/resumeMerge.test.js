import test from "node:test";
import assert from "node:assert/strict";
import {
  interpretModelTurn,
  mergeModelResume,
  normalizeResume,
} from "../src/services/resume.service.js";

const current = normalizeResume({
  contact: { name: "Ada Lovelace", title: "Engineer", email: "ada@example.com" },
  summary: "Builds analytical engines.",
  experience: [{ id: "exp-1", role: "Dev", company: "Acme", bullets: ["Did a thing"] }],
  skills: [{ id: "skl-1", category: "Languages", items: ["JS"] }],
});

test("a model reply carrying only one section doesn't blank the others", () => {
  const turn = interpretModelTurn({
    experience: [{ id: "exp-1", role: "Senior Dev", company: "Acme", bullets: ["Did it better"] }],
  });
  const out = mergeModelResume(current, turn.resume);
  assert.equal(out.contact.name, "Ada Lovelace");
  assert.equal(out.summary, "Builds analytical engines.");
  assert.deepEqual(out.skills, current.skills);
  assert.equal(out.experience[0].role, "Senior Dev");
});

test("a section the model sends empty is a deliberate removal", () => {
  const out = mergeModelResume(current, { skills: [], summary: "" });
  assert.deepEqual(out.skills, []);
  assert.equal(out.summary, "");
  assert.equal(out.contact.email, "ada@example.com");
});

test("contact merges field by field", () => {
  const out = mergeModelResume(current, { contact: { phone: "555-0100" } });
  assert.equal(out.contact.phone, "555-0100");
  assert.equal(out.contact.name, "Ada Lovelace");
  assert.equal(out.contact.email, "ada@example.com");
});

test("a complete document from the model still replaces everything it covers", () => {
  const full = normalizeResume({ contact: { name: "Grace Hopper" }, summary: "Compilers." });
  const out = mergeModelResume(current, full);
  assert.equal(out.contact.name, "Grace Hopper");
  assert.equal(out.contact.email, "", "a full document's empty field wins");
  assert.equal(out.summary, "Compilers.");
  assert.deepEqual(out.experience, []);
});

test("junk from the model leaves the current document intact", () => {
  assert.deepEqual(mergeModelResume(current, null), current);
  assert.deepEqual(mergeModelResume(current, ["nope"]), current);
});
