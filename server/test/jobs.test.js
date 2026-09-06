import test from "node:test";
import assert from "node:assert/strict";
import {
  stripHtml,
  truncate,
  cityToken,
  resolveAdzunaCountry,
  searchTextFromProfile,
  normalizeAdzunaJob,
  dedupeJobs,
  sortByScore,
  isHttpUrl,
  formatSalary,
  currencyForCountry,
} from "../src/services/jobs.service.js";
import { mapWithConcurrency } from "../src/controllers/jobs.controller.js";

test("stripHtml flattens tags and entities to text", () => {
  assert.equal(
    stripHtml("<p>Hello&nbsp;<b>world</b></p><p>Line&amp;two</p>"),
    "Hello world\nLine&two"
  );
});

test("truncate adds an ellipsis only past the limit", () => {
  assert.equal(truncate("abcdef", 3), "abc…");
  assert.equal(truncate("abc", 10), "abc");
});

test("cityToken keeps only the first segment", () => {
  assert.equal(cityToken("Austin, TX"), "Austin");
  assert.equal(cityToken("  London , United Kingdom"), "London");
  assert.equal(cityToken(""), "");
});

test("resolveAdzunaCountry normalizes valid codes and rejects the rest", () => {
  assert.equal(resolveAdzunaCountry("ca"), "ca");
  assert.equal(resolveAdzunaCountry("CA"), "ca");
  assert.equal(resolveAdzunaCountry("  Gb "), "gb");
  assert.equal(resolveAdzunaCountry("ie"), null); // not served by Adzuna
  assert.equal(resolveAdzunaCountry("canada"), null);
  assert.equal(resolveAdzunaCountry(""), null);
  assert.equal(resolveAdzunaCountry(undefined), null);
});

test("searchTextFromProfile joins field + titles + keywords, unique, capped at 8", () => {
  const out = searchTextFromProfile({
    field: "Data Science",
    titles: ["Data Scientist", "ML Engineer"],
    keywords: ["Python", "Python", "SQL", "ML", "Spark", "AWS", "Airflow", "dbt"],
  });
  assert.equal(out, "Data Science Data Scientist ML Engineer Python SQL ML Spark AWS");
});

test("searchTextFromProfile tolerates junk", () => {
  assert.equal(searchTextFromProfile(null), "");
  assert.equal(searchTextFromProfile({}), "");
});

test("normalizeAdzunaJob maps fields and formats salary in the given currency", () => {
  const raw = {
    id: "42",
    title: "Senior <b>Frontend</b> Engineer",
    description: "Build <i>things</i>",
    redirect_url: "https://www.adzuna.com/land/ad/42",
    company: { display_name: "Acme" },
    location: { display_name: "Austin, TX" },
    salary_min: 120000,
    salary_max: 150000,
    created: "2026-08-01",
  };
  const usd = normalizeAdzunaJob(raw, { money: currencyForCountry("us") });
  assert.equal(usd.source, "Adzuna");
  assert.equal(usd.title, "Senior Frontend Engineer");
  assert.equal(usd.company, "Acme");
  assert.equal(usd.location, "Austin, TX");
  assert.match(usd.salary, /\$120,000\s*–\s*\$150,000/);
  assert.equal(usd.url, "https://www.adzuna.com/land/ad/42");
  assert.equal(usd.id, "adzuna:42");

  const gbp = normalizeAdzunaJob(raw, { money: currencyForCountry("gb") });
  assert.match(gbp.salary, /£120,000/);
});

test("normalizeAdzunaJob returns null without a title or a valid http url", () => {
  assert.equal(normalizeAdzunaJob({ title: "x" }), null);
  assert.equal(normalizeAdzunaJob(null), null);
  assert.equal(
    normalizeAdzunaJob({ title: "x", redirect_url: "javascript:alert(1)" }),
    null
  );
});

test("isHttpUrl accepts only absolute http(s) urls", () => {
  assert.equal(isHttpUrl("https://example.com/a"), true);
  assert.equal(isHttpUrl("http://example.com"), true);
  assert.equal(isHttpUrl("javascript:alert(1)"), false);
  assert.equal(isHttpUrl("/relative/path"), false);
  assert.equal(isHttpUrl(""), false);
  assert.equal(isHttpUrl(null), false);
});

test("formatSalary handles ranges, single values, and missing data", () => {
  const usd = { locale: "en-US", currency: "USD" };
  assert.match(formatSalary(100000, 120000, usd), /\$100,000\s*–\s*\$120,000/);
  assert.equal(formatSalary(90000, 90000, usd), "$90,000");
  assert.match(formatSalary(80000, null, usd), /\$80,000/);
  assert.equal(formatSalary(null, null, usd), "");
  // no currency mapping -> plain grouped number, no symbol
  assert.equal(formatSalary(50000, 60000, null), "50,000–60,000");
});

test("dedupeJobs drops id dupes and same company+title (any location)", () => {
  const out = dedupeJobs([
    { id: "a", company: "Acme", title: "Eng", location: "NYC" },
    { id: "a", company: "Acme", title: "Eng", location: "NYC" },
    { id: "b", company: "Acme", title: "Eng", location: "NYC" },
    { id: "c", company: "Acme", title: "Eng", location: "SF" },
    { id: "d", company: "Acme", title: "Manager", location: "SF" },
  ]);
  assert.deepEqual(
    out.map((j) => j.id),
    ["a", "d"]
  );
});

test("sortByScore ranks high first and sinks unscored", () => {
  const out = sortByScore([
    { id: "a", matchScore: 40 },
    { id: "b", matchScore: null },
    { id: "c", matchScore: 90 },
  ]);
  assert.deepEqual(out.map((j) => j.id), ["c", "a", "b"]);
});

test("mapWithConcurrency preserves order and respects the limit", async () => {
  let inFlight = 0;
  let peak = 0;
  const out = await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async (n) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight -= 1;
    return n * 2;
  });
  assert.deepEqual(out, [2, 4, 6, 8, 10, 12]);
  assert.ok(peak <= 2, `peak concurrency ${peak} exceeded 2`);
});
