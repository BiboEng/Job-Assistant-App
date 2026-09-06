import { config } from "../config.js";

/**
 * Job-listing source for the Job Matches feature.
 *
 * Adzuna (https://developer.adzuna.com) is the sole source — a keyed REST API
 * over a broad, all-company job aggregator, searched with keywords pulled from
 * the resume and filtered to the user's city (+ radius) server-side at Adzuna.
 * This is a documented/public JSON API — never scraping rendered HTML from
 * LinkedIn, Indeed, or any company's own careers site.
 *
 * `searchAdzuna` resolves to a result object rather than throwing, so an Adzuna
 * outage surfaces as a warning, not a crash.
 */

const EXTERNAL_TIMEOUT_MS = 12_000;
const DESC_LIMIT = 4_000;

// --- pure helpers (unit-tested) ----------------------------------------

/** Collapse HTML to readable plain text. Model input + never rendered as HTML. */
export function stripHtml(input) {
  if (!input) return "";
  return String(input)
    .replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&rsquo;|&lsquo;/gi, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/gi, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function truncate(str, max) {
  const s = String(str ?? "");
  return s.length > max ? `${s.slice(0, max).trimEnd()}…` : s;
}

/** True only for an absolute http(s) URL — used to gate what we put in an href. */
export function isHttpUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Format an Adzuna salary range in the job's own currency. Adzuna returns bare
 * numbers with no currency field, so the currency/locale comes from the country
 * that was searched (see config.adzuna.currencyByCountry). Falls back to a plain
 * grouped number when the country isn't mapped.
 */
export function formatSalary(min, max, money) {
  const toNum = (v) =>
    v === null || v === undefined || v === "" ? NaN : Number(v);
  const lo = toNum(min);
  const hi = toNum(max);
  if (!Number.isFinite(lo) && !Number.isFinite(hi)) return "";

  const locale = money?.locale || "en-US";
  const fmt = money?.currency
    ? (n) =>
        new Intl.NumberFormat(locale, {
          style: "currency",
          currency: money.currency,
          maximumFractionDigits: 0,
        }).format(Math.round(n))
    : (n) => new Intl.NumberFormat(locale).format(Math.round(n));

  if (Number.isFinite(lo) && Number.isFinite(hi)) {
    return lo === hi ? fmt(lo) : `${fmt(lo)}–${fmt(hi)}`;
  }
  return fmt(Number.isFinite(lo) ? lo : hi);
}

/** { locale, currency } for an Adzuna country code, or null when unmapped. */
export function currencyForCountry(country) {
  const code = String(country || "").trim().toLowerCase();
  return config.adzuna.currencyByCountry[code] || null;
}

/** First segment of a "City, ST" / "City, Country" string — what job APIs want. */
export function cityToken(city) {
  return String(city || "").split(",")[0].trim();
}

/**
 * Validate an Adzuna country code against the supported list.
 * @returns {string|null} the normalized lowercase code, or null if unsupported.
 */
export function resolveAdzunaCountry(input) {
  const code = String(input || "").trim().toLowerCase();
  return config.adzuna.supportedCountries.includes(code) ? code : null;
}

/** Space-joined keyword string for the broad-match ("what_or") Adzuna query. */
export function searchTextFromProfile(profile) {
  if (!profile || typeof profile !== "object") return "";
  const titles = Array.isArray(profile.titles) ? profile.titles : [];
  const kws = Array.isArray(profile.keywords) ? profile.keywords : [];
  const parts = [profile.field, ...titles, ...kws].filter(
    (p) => typeof p === "string" && p.trim()
  );
  return [...new Set(parts.map((p) => p.trim()))]
    .slice(0, 8)
    .join(" ")
    .slice(0, 220);
}

/**
 * Normalize one Adzuna `results[]` entry. Returns null if unusable.
 * @param {object} raw
 * @param {{ money?: { locale: string, currency: string } }} [ctx]
 */
export function normalizeAdzunaJob(raw, ctx = {}) {
  if (!raw || typeof raw !== "object") return null;
  const title = typeof raw.title === "string" ? stripHtml(raw.title) : "";
  const url = isHttpUrl(raw.redirect_url) ? raw.redirect_url : "";
  if (!title || !url) return null;

  const company = stripHtml(raw.company?.display_name) || "Company not disclosed";
  const location =
    stripHtml(raw.location?.display_name) ||
    (Array.isArray(raw.location?.area) ? raw.location.area.join(", ") : "") ||
    "Location not specified";

  const salary = formatSalary(raw.salary_min, raw.salary_max, ctx.money);

  return {
    id: `adzuna:${raw.id ?? url}`,
    source: "Adzuna",
    company,
    title,
    location,
    salary,
    url,
    description: truncate(stripHtml(raw.description), DESC_LIMIT),
    postedAt: typeof raw.created === "string" ? raw.created : "",
  };
}

/**
 * Drop exact dupes (same id) and near-dupes (same company + title — an aggregator
 * often lists one role once per office/suburb).
 */
export function dedupeJobs(jobs) {
  const seen = new Set();
  const out = [];
  for (const job of jobs) {
    if (!job) continue;
    const soft = `${job.company}|${job.title}`.toLowerCase();
    if (seen.has(job.id) || seen.has(soft)) continue;
    seen.add(job.id);
    seen.add(soft);
    out.push(job);
  }
  return out;
}

/** Highest match score first; unscored jobs sink to the bottom. */
export function sortByScore(jobs) {
  return [...jobs].sort((a, b) => {
    const sa = Number.isFinite(a.matchScore) ? a.matchScore : -1;
    const sb = Number.isFinite(b.matchScore) ? b.matchScore : -1;
    return sb - sa;
  });
}

// --- network helpers (never throw to the caller) ---------------------

async function fetchJson(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(EXTERNAL_TIMEOUT_MS),
    headers: {
      Accept: "application/json, text/plain, */*",
      "User-Agent":
        "Mozilla/5.0 (compatible; mock-interview-app/0.1; +job-matches)",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const err = new Error(`Upstream responded ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

function adzunaUrl(countryCode, { what, whatOr, where }) {
  const qs = new URLSearchParams({
    app_id: config.adzuna.appId,
    app_key: config.adzuna.appKey,
    results_per_page: String(config.jobMatch.adzunaResultsPerPage),
    "content-type": "application/json",
  });
  if (what) qs.set("what", what);
  else if (whatOr) qs.set("what_or", whatOr);
  const town = cityToken(where);
  if (town) {
    qs.set("where", town);
    qs.set("distance", String(config.jobMatch.adzunaDistanceKm));
  }
  return `${config.adzuna.baseUrl}/jobs/${encodeURIComponent(
    countryCode
  )}/search/1?${qs}`;
}

/**
 * Adzuna keyword + city search. Resolves to `{ jobs, error, total }` — never
 * throws, so an Adzuna outage surfaces as a warning rather than a crash.
 *
 * `what` is an AND match (every term must appear) and gives the cleanest results
 * when the field name is a good one ("Frontend Engineering"). But an AND match
 * on a narrow field often returns nothing, so when `what` yields zero results we
 * retry once with the looser OR match (`whatOr`) before giving up.
 *
 * `country` is an Adzuna country code (already validated by the caller); it
 * selects which national job board to search and defaults to
 * `config.adzuna.country`.
 * @param {{ what?: string, whatOr?: string, where: string, country?: string }} params
 */
export async function searchAdzuna({ what, whatOr, where, country }) {
  const { appId, appKey } = config.adzuna;
  const countryCode = country || config.adzuna.country;
  if (!appId || !appKey) {
    return { jobs: [], total: 0, error: "Adzuna keys are not configured." };
  }

  const money = currencyForCountry(countryCode);
  const attempts = [];
  if (what) attempts.push({ what, where });
  if (whatOr && whatOr !== what) attempts.push({ whatOr, where });
  if (attempts.length === 0) attempts.push({ where });

  try {
    let total = 0;
    for (const params of attempts) {
      const data = await fetchJson(adzunaUrl(countryCode, params));
      const results = Array.isArray(data?.results) ? data.results : [];
      total = Number.isFinite(data?.count) ? data.count : results.length;
      const jobs = results
        .map((r) => normalizeAdzunaJob(r, { money }))
        .filter(Boolean);
      if (jobs.length > 0) return { jobs, total, error: null };
    }
    return { jobs: [], total, error: null };
  } catch (err) {
    console.error("[jobs] Adzuna failed:", err.message);
    return {
      jobs: [],
      total: 0,
      error: "Adzuna job search is unavailable right now.",
    };
  }
}
