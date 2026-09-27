import test from "node:test";
import assert from "node:assert/strict";
import {
  roleKey,
  heuristicTitle,
  cleanRoleTitle,
  effectiveRole,
  isLabelled,
  displayTitle,
  groupByRole,
} from "../src/services/roleLabel.js";
import { normalizeThemes, parseRoleLabels } from "../src/services/progress.service.js";
import {
  feedbackThemesUserMessage,
  roleLabelSystemPrompt,
} from "../src/prompts/index.js";

/* --- roleKey ---------------------------------------------------------------- */

test("roleKey merges spellings and synonyms of the same role", () => {
  const same = [
    "Frontend Engineer",
    "Front-End Developer",
    "Front End Engineer",
    "Senior Frontend Engineer",
    "Sr. Front-end Dev",
    "Frontend Engineer II",
    "Frontend Engineer (Remote)",
    "Lead Frontend Programmer",
  ];
  for (const t of same) assert.equal(roleKey(t), "frontend engineer", t);
});

test("roleKey keeps genuinely different roles apart", () => {
  assert.notEqual(roleKey("Data Analyst"), roleKey("Data Scientist"));
  assert.notEqual(roleKey("Frontend Engineer"), roleKey("Backend Engineer"));
  assert.notEqual(roleKey("Product Manager"), roleKey("Product Designer"));
});

test("roleKey expands common abbreviations", () => {
  assert.equal(roleKey("SWE"), roleKey("Software Engineer"));
  assert.equal(roleKey("Senior Software Developer"), "software engineer");
  assert.equal(roleKey("PM"), roleKey("Product Manager"));
  assert.equal(roleKey("ML Engineer"), roleKey("Machine Learning Engineer"));
  assert.equal(roleKey("Full-Stack Developer"), roleKey("Fullstack Engineer"));
});

test("roleKey doesn't double a word an abbreviation already supplied", () => {
  assert.equal(roleKey("Software Engineer SWE"), "software engineer");
});

test("roleKey keeps C++ / C# distinct and never returns empty", () => {
  assert.notEqual(roleKey("C++ Developer"), roleKey("C# Developer"));
  assert.equal(roleKey(""), "role");
  assert.equal(roleKey("Senior"), "role");
  assert.equal(roleKey(null), "role");
});

/* --- heuristicTitle / cleanRoleTitle ---------------------------------------- */

test("heuristicTitle trims a posting's first line down to the role", () => {
  assert.equal(
    heuristicTitle("Senior Frontend Engineer — Design Systems\nWe build..."),
    "Frontend Engineer"
  );
  assert.equal(heuristicTitle("\n\n  Data Analyst at Acme Corp\nabout us"), "Data Analyst");
  assert.equal(heuristicTitle("Job Title: Product Manager | London"), "Product Manager");
  assert.equal(heuristicTitle("Backend Engineer (Remote), Payments"), "Backend Engineer");
  assert.equal(heuristicTitle(""), "Untitled role");
});

test("cleanRoleTitle strips quotes and newlines, bounds length, rejects junk", () => {
  assert.equal(cleanRoleTitle('  "Frontend Engineer".  '), "Frontend Engineer");
  assert.equal(cleanRoleTitle("Data\nAnalyst"), "Data Analyst");
  assert.ok(cleanRoleTitle("x".repeat(500)).length <= 60);
  assert.equal(cleanRoleTitle(""), null);
  assert.equal(cleanRoleTitle(42), null);
});

/* --- effectiveRole / displayTitle ------------------------------------------- */

test("effectiveRole prefers a stored label and falls back to the first line", () => {
  const jd = "Senior Data Analyst — Growth\n...";
  assert.deepEqual(effectiveRole({ jobDescription: jd }), {
    title: "Data Analyst",
    source: "heuristic",
  });
  assert.deepEqual(
    effectiveRole({ jobDescription: jd, role: { title: "Business Analyst", source: "model" } }),
    { title: "Business Analyst", source: "model" }
  );
  // An unknown source isn't trusted as a settled label.
  assert.equal(
    effectiveRole({ jobDescription: jd, role: { title: "X", source: "client" } }).source,
    "heuristic"
  );
  assert.equal(isLabelled({ role: { title: "Y", source: "fallback" } }), true);
  assert.equal(isLabelled({ role: { title: "", source: "model" } }), false);
});

test("displayTitle picks the most common model title, ties to the most recent", () => {
  assert.equal(
    displayTitle([
      { title: "Frontend Engineer", source: "model", createdAt: 1 },
      { title: "Front-End Developer", source: "model", createdAt: 3 },
      { title: "Frontend Engineer", source: "model", createdAt: 2 },
      { title: "Senior FE", source: "heuristic", createdAt: 4 },
    ]),
    "Frontend Engineer"
  );
  assert.equal(
    displayTitle([
      { title: "A", source: "model", createdAt: 1 },
      { title: "B", source: "model", createdAt: 5 },
    ]),
    "B"
  );
  assert.equal(displayTitle([{ title: "Only Heuristic", source: "heuristic", createdAt: 1 }]), "Only Heuristic");
});

/* --- groupByRole ------------------------------------------------------------ */

const rec = (id, createdAt, score, title, jd = `${title}\nbody`) => ({
  id,
  createdAt,
  jobDescription: jd,
  feedback: { overallScore: score, strengths: ["s"], weaknesses: ["w"] },
  qaPairs: [{ question: "q", answer: "a", delivery: { wpm: 150 } }],
  role: title ? { title, source: "model" } : undefined,
});

test("groupByRole clusters similar titles and orders each trend oldest-first", () => {
  const groups = groupByRole([
    rec("c", 300, 80, "Frontend Engineer"),
    rec("a", 100, 50, "Front-End Developer"),
    rec("d", 400, 70, "Data Analyst"),
    rec("b", 200, 65, "Frontend Engineer"),
  ]);

  assert.equal(groups.length, 2);
  // Most recently practised role first.
  assert.equal(groups[0].key, "data analyst");
  const fe = groups[1];
  assert.equal(fe.key, "frontend engineer");
  assert.equal(fe.title, "Frontend Engineer");
  assert.equal(fe.count, 3);
  assert.deepEqual(fe.interviews.map((i) => i.id), ["a", "b", "c"]);
  assert.equal(fe.latestScore, 80);
  assert.equal(fe.bestScore, 80);
  assert.equal(fe.averageScore, 65);
  assert.equal(fe.change, 30);
});

test("groupByRole: a single interview has no trend (change is null, not 0)", () => {
  const [only] = groupByRole([rec("x", 1, 72, "Data Analyst")]);
  assert.equal(only.count, 1);
  assert.equal(only.change, null);
});

test("groupByRole carries no feedback text or delivery metrics", () => {
  const [g] = groupByRole([rec("x", 1, 72, "Data Analyst")]);
  const json = JSON.stringify(g);
  assert.doesNotMatch(json, /wpm|delivery|strengths|weaknesses|answer/);
  assert.deepEqual(Object.keys(g.interviews[0]).sort(), [
    "createdAt",
    "id",
    "jobTitle",
    "overallScore",
  ]);
});

test("groupByRole groups unlabelled interviews by their first line", () => {
  const groups = groupByRole([
    rec("a", 1, 40, undefined, "Senior Frontend Engineer — Payments\n..."),
    rec("b", 2, 60, "Frontend Engineer"),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].title, "Frontend Engineer");
  assert.equal(groups[0].count, 2);
});

test("groupByRole tolerates garbage records and clamps scores", () => {
  const groups = groupByRole([
    null,
    { nope: true },
    { id: "z", createdAt: 5, jobDescription: "QA Engineer", feedback: { overallScore: 900 } },
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].latestScore, 100);
});

/* --- parseRoleLabels ---------------------------------------------------------- */

test("parseRoleLabels maps titles back by posting number", () => {
  const out = parseRoleLabels(
    { roles: [{ n: 2, title: "Data Analyst" }, { n: 1, title: "Frontend Engineer" }] },
    3
  );
  assert.deepEqual(out, ["Frontend Engineer", "Data Analyst", null]);
});

test("parseRoleLabels falls back to position and ignores out-of-range numbers", () => {
  assert.deepEqual(parseRoleLabels({ roles: [{ title: "A" }, { title: "B" }] }, 2), ["A", "B"]);
  assert.deepEqual(parseRoleLabels({ roles: [{ n: 9, title: "A" }] }, 1), ["A"]);
  assert.deepEqual(parseRoleLabels({ roles: [{ n: 1, title: "" }] }, 1), [null]);
  assert.deepEqual(parseRoleLabels("garbage", 2), [null, null]);
});

/* --- normalizeThemes ---------------------------------------------------------- */

const IDS = ["i1", "i2", "i3", "i4", "i5"];

test("normalizeThemes counts from validated interview numbers, not model claims", () => {
  const out = normalizeThemes(
    {
      weaknesses: [
        // 9 is out of range, 2 is repeated, "3" is a string — count is 3.
        { theme: "Could give more specific examples", interviews: [1, 2, 2, "3", 9], count: 99 },
      ],
      strengths: [],
    },
    IDS
  );
  assert.equal(out.weaknesses.length, 1);
  assert.equal(out.weaknesses[0].count, 3);
  assert.deepEqual(out.weaknesses[0].interviewIds, ["i1", "i2", "i3"]);
});

test("normalizeThemes drops themes with no valid interview and sorts by count", () => {
  const out = normalizeThemes(
    {
      strengths: [
        { theme: "Once", interviews: [5] },
        { theme: "Nowhere", interviews: [0, 42] },
        { theme: "Often", interviews: [1, 2, 3, 4] },
        { theme: "", interviews: [1] },
      ],
    },
    IDS
  );
  assert.deepEqual(out.strengths.map((t) => t.theme), ["Often", "Once"]);
  assert.deepEqual(out.weaknesses, []);
});

test("normalizeThemes merges duplicate theme text and caps each side", () => {
  const many = Array.from({ length: 12 }, (_, i) => ({ theme: `T${i}`, interviews: [1] }));
  const out = normalizeThemes(
    {
      strengths: [
        { theme: "Clear structure", interviews: [1] },
        { theme: "clear structure", interviews: [4] },
      ],
      weaknesses: many,
    },
    IDS
  );
  assert.equal(out.strengths.length, 1);
  assert.deepEqual(out.strengths[0].interviewIds, ["i1", "i4"]);
  assert.ok(out.weaknesses.length <= 6);
});

test("normalizeThemes tolerates garbage", () => {
  assert.deepEqual(normalizeThemes(null, IDS), { strengths: [], weaknesses: [] });
  assert.deepEqual(normalizeThemes({ strengths: "nope" }, IDS).strengths, []);
});

/* --- prompts ------------------------------------------------------------------ */

test("the themes message sends only strengths and weaknesses, oldest first", () => {
  const msg = feedbackThemesUserMessage([
    { strengths: ["clear"], weaknesses: [] },
    { strengths: [], weaknesses: ["vague"] },
  ]);
  assert.match(msg, /INTERVIEW 1[\s\S]*clear[\s\S]*INTERVIEW 2[\s\S]*vague/);
  assert.match(msg, /\(none\)/);
});

test("the role-label prompt hands over the user's existing titles", () => {
  assert.match(roleLabelSystemPrompt(["Frontend Engineer"]), /- Frontend Engineer/);
  assert.doesNotMatch(roleLabelSystemPrompt([]), /already practised/);
});
