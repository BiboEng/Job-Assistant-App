import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultPaper,
  firstUnencodable,
  isPdfEncodable,
  linkTarget,
  toPdfText,
} from "../src/utils/resumeExport.js";
import { coerceResume, emptyResume } from "../src/utils/resumeModel.js";

const withName = (name, extra = {}) => ({
  ...emptyResume(),
  ...extra,
  contact: { ...emptyResume().contact, name },
});

test("isPdfEncodable accepts Windows-1252 — Latin-1 plus curly quotes, dashes, €", () => {
  assert.equal(isPdfEncodable("Zoë Müller — “quoted” – €5 • café"), true);
  assert.equal(isPdfEncodable("Łukasz"), false);
  assert.equal(isPdfEncodable("Иван"), false);
  assert.equal(isPdfEncodable("محمد"), false);
  assert.equal(isPdfEncodable("李"), false);
});

test("toPdfText maps common symbols so one of them can't garble a whole line", () => {
  assert.equal(toPdfText("Cut costs → 40% − fast ✓"), "Cut costs -> 40% - fast -");
  assert.equal(toPdfText("a​b c"), "ab c");
  assert.ok(isPdfEncodable(toPdfText("≥ 3 ≤ 5 ≠ 4 ≈ 4 ← ↔ ▪")));
});

test("firstUnencodable finds a real non-Latin character, and ignores mapped symbols", () => {
  assert.equal(firstUnencodable(withName("Ada", { summary: "Faster → better" })), null);
  assert.equal(firstUnencodable(withName("Łukasz Nowak")), "Ł");
  const inBullet = {
    ...withName("Ada"),
    experience: [{ id: "e", role: "Dev", company: "X", location: "", start: "", end: "", bullets: ["Led 李 team"] }],
  };
  assert.equal(firstUnencodable(inBullet), "李");
});

test("linkTarget makes URLs, bare domains and emails clickable — nothing else", () => {
  assert.equal(linkTarget("https://ada.dev/x"), "https://ada.dev/x");
  assert.equal(linkTarget("linkedin.com/in/ada"), "https://linkedin.com/in/ada");
  assert.equal(linkTarget("ada@example.com"), "mailto:ada@example.com");
  assert.equal(linkTarget("javascript:alert(1)"), null);
  assert.equal(linkTarget("My portfolio"), null);
  assert.equal(linkTarget(""), null);
});

test("defaultPaper picks Letter for US-style regions and A4 elsewhere", () => {
  assert.equal(defaultPaper("en-US"), "letter");
  assert.equal(defaultPaper("en-CA"), "letter");
  assert.equal(defaultPaper("en-GB"), "a4");
  assert.equal(defaultPaper("de-DE"), "a4");
  assert.equal(defaultPaper("fr"), "a4");
  assert.equal(defaultPaper("en"), "letter");
  assert.equal(defaultPaper(""), "letter");
});

test("coerceResume restores a saved draft and repairs a malformed one", () => {
  const draft = withName("Ada", {
    summary: "Hi",
    experience: [{ id: "e", role: "Dev", bullets: ["x", 5] }],
  });
  const back = coerceResume(JSON.parse(JSON.stringify(draft)));
  assert.equal(back.contact.name, "Ada");
  assert.deepEqual(back.experience[0].bullets, ["x", ""]);

  const junk = coerceResume({ contact: "nope", skills: "nope", experience: [null, 3] });
  assert.deepEqual(junk.skills, []);
  assert.deepEqual(junk.experience, []);
  assert.equal(junk.contact.name, "");
  assert.equal(coerceResume(null), null);
  assert.equal(coerceResume([]), null);
});
