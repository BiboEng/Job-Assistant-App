import { config } from "../config.js";
import { chatCompletionJson } from "../services/openrouter.service.js";
import {
  resumeProfileSystemPrompt,
  jobMatchSystemPrompt,
  jobMatchUserMessage,
} from "../prompts/index.js";
import {
  searchAdzuna,
  searchTextFromProfile,
  dedupeJobs,
  resolveAdzunaCountry,
} from "../services/jobs.service.js";

/**
 * Job Matches is a two-phase flow so the client can show results immediately and
 * fill scores in progressively (instead of one ~1-minute blocking request):
 *
 *   POST /api/jobs/search  { resumeText, city, country }
 *     -> one model call (resume -> search profile) + one Adzuna search.
 *        Returns the (unscored) jobs, each carrying enough text for scoring.
 *
 *   POST /api/jobs/score   { resumeText, jobs: [...] }
 *     -> scores a small batch of those jobs against the resume, one model call
 *        each. The client calls this repeatedly, a batch at a time.
 *
 * Both phases run in the "jobs" model-budget pool, which is separate from the
 * live-interview pool.
 */

const CLIENT_DESC_LIMIT = 700;

// --- POST /api/jobs/search -------------------------------------------------

export async function searchJobs(req, res, next) {
  try {
    const { resumeText, city, country } = req.body ?? {};

    const resume = validateResume(resumeText, res);
    if (resume === null) return;

    if (typeof city !== "string" || city.trim().length < 2) {
      return res.status(400).json({ error: "Enter the city you want to work in." });
    }
    const where = city.trim().slice(0, 80);

    let countryCode = config.adzuna.country;
    if (country != null && String(country).trim() !== "") {
      const resolved = resolveAdzunaCountry(country);
      if (!resolved) {
        return res
          .status(400)
          .json({ error: "Pick a supported country for the job search." });
      }
      countryCode = resolved;
    }

    // --- resume -> search profile (one model call) ---------------------
    let profile;
    try {
      profile = await deriveProfile(resume);
    } catch (err) {
      console.error("[jobs] profile step failed:", err.message);
      const busy = err?.status === 429 || err?.status === 503;
      const e = new Error(
        busy
          ? "The AI service is busy right now. Wait a moment and try again."
          : "Couldn't analyze your resume right now. Please try again in a moment."
      );
      e.status = busy ? err.status : 502;
      e.expose = true;
      return next(e);
    }

    const field = profile.field || profile.titles?.[0] || "";
    const whatOr = searchTextFromProfile(profile) || field;

    // --- Adzuna search, broad across all companies/roles --------------
    const adzuna = await searchAdzuna({
      what: field,
      whatOr,
      where,
      country: countryCode,
    });

    const warnings = [];
    if (adzuna.error) warnings.push(adzuna.error);

    const pool = dedupeJobs(adzuna.jobs).slice(0, config.jobMatch.maxScored);

    if (pool.length === 0) {
      return res.status(200).json({
        profile: publicProfile(profile),
        jobs: [],
        warnings,
        message:
          warnings.length > 0
            ? "No jobs came back. Adzuna is unavailable right now — try again shortly."
            : `No open roles matched "${where}". Try a larger nearby city or a broader field.`,
      });
    }

    return res.status(200).json({
      profile: publicProfile(profile),
      jobs: pool.map(searchResultJob),
      warnings,
      message: null,
    });
  } catch (err) {
    next(err);
  }
}

// --- POST /api/jobs/score -------------------------------------------------

export async function scoreJobs(req, res, next) {
  try {
    const { resumeText, jobs } = req.body ?? {};

    const resume = validateResume(resumeText, res);
    if (resume === null) return;

    if (!Array.isArray(jobs) || jobs.length === 0) {
      return res.status(400).json({ error: "No jobs to score." });
    }
    if (jobs.length > config.jobMatch.scoreBatchMax) {
      return res.status(400).json({
        error: `Score at most ${config.jobMatch.scoreBatchMax} jobs per request.`,
      });
    }

    const clean = jobs
      .map((j) => ({
        id: typeof j?.id === "string" ? j.id : "",
        company: String(j?.company ?? "").slice(0, 200),
        title: String(j?.title ?? "").slice(0, 200),
        location: String(j?.location ?? "").slice(0, 200),
        description: String(j?.description ?? "").slice(0, CLIENT_DESC_LIMIT * 3),
      }))
      .filter((j) => j.id && j.title);

    if (clean.length === 0) {
      return res.status(400).json({ error: "No usable jobs to score." });
    }

    const scores = await mapWithConcurrency(
      clean,
      config.jobMatch.scoreConcurrency,
      async (job) => ({ id: job.id, ...(await scoreJob(resume, job)) })
    );

    return res.status(200).json({ scores });
  } catch (err) {
    next(err);
  }
}

// --- helpers ------------------------------------------------------------

/** Returns the trimmed resume, or null after writing a 4xx response. */
function validateResume(resumeText, res) {
  if (typeof resumeText !== "string" || !resumeText.trim()) {
    res.status(400).json({ error: "Add your resume first so we can match jobs to it." });
    return null;
  }
  const resume = resumeText.trim();
  if (resume.length < config.minResumeLength) {
    res.status(400).json({
      error: "That resume looks too short to match on. Upload the full document.",
    });
    return null;
  }
  if (resume.length > config.maxResumeLength) {
    res.status(400).json({
      error: `Resume text must be at most ${config.maxResumeLength} characters.`,
    });
    return null;
  }
  return resume;
}

async function deriveProfile(resume) {
  const raw = await chatCompletionJson(
    [
      { role: "system", content: resumeProfileSystemPrompt() },
      { role: "user", content: `RESUME:\n${resume}\n\nReturn the profile JSON.` },
    ],
    { kind: "jobs" }
  );

  const arr = (v) =>
    Array.isArray(v) ? v.map((s) => String(s).trim()).filter(Boolean) : [];

  return {
    field: typeof raw?.field === "string" ? raw.field.trim() : "",
    seniority: typeof raw?.seniority === "string" ? raw.seniority.trim() : "",
    keywords: arr(raw?.keywords).slice(0, 10),
    titles: arr(raw?.titles).slice(0, 6),
  };
}

async function scoreJob(resume, job) {
  try {
    const raw = await chatCompletionJson(
      [
        { role: "system", content: jobMatchSystemPrompt() },
        { role: "user", content: jobMatchUserMessage(resume, job) },
      ],
      { kind: "jobs" }
    );
    const n = Math.round(Number(raw?.matchScore));
    const matchScore = Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : null;
    const reason =
      typeof raw?.reason === "string" && raw.reason.trim()
        ? raw.reason.trim().slice(0, 240)
        : matchScore == null
        ? "Couldn't score this role automatically."
        : "";
    return { matchScore, reason };
  } catch (err) {
    console.error("[jobs] scoring failed for", job.id, err.message);
    return { matchScore: null, reason: "Couldn't score this role automatically." };
  }
}

/** Run `fn` over `items` with at most `limit` in flight, preserving order. */
export async function mapWithConcurrency(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    }
  );
  await Promise.all(workers);
  return out;
}

function publicProfile(p) {
  return {
    field: p.field,
    seniority: p.seniority,
    keywords: p.keywords,
    titles: p.titles,
  };
}

/** Shape sent to the client from /search — includes text needed by /score. */
function searchResultJob(j) {
  return {
    id: j.id,
    source: j.source,
    company: j.company,
    title: j.title,
    location: j.location,
    salary: j.salary || "",
    url: j.url,
    postedAt: j.postedAt || "",
    description: (j.description || "").slice(0, CLIENT_DESC_LIMIT),
    matchScore: null,
    reason: "",
  };
}
