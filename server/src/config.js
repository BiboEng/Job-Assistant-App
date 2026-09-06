import dotenv from "dotenv";

dotenv.config();

const num = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/**
 * `TRUST_PROXY` accepts the same shapes Express does: "true"/"false", a hop
 * count ("1"), or a comma-separated subnet list. Default is loopback-only so the
 * rate limiter keys on the real client IP behind a single known proxy only when
 * you opt in.
 */
function parseTrustProxy(v) {
  if (v == null || v === "") return "loopback";
  if (v === "true") return true;
  if (v === "false") return false;
  const n = Number(v);
  if (Number.isInteger(n)) return n;
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * Central config. Swap the model here (or via OPENROUTER_MODEL in .env) when
 * testing different OpenRouter models.
 */
export const config = {
  port: num(process.env.PORT, 3001),

  // The AI model. Kept as one constant so it's trivial to swap.
  model: process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini",

  openRouter: {
    apiKey: process.env.OPENROUTER_API_KEY || "",
    url: "https://openrouter.ai/api/v1/chat/completions",
    // Optional attribution headers OpenRouter recommends. Harmless if left as-is.
    referer: process.env.OPENROUTER_REFERER || "http://localhost:5173",
    title: "Mock Interview App",
    // Abort an upstream call that hangs longer than this.
    timeoutMs: num(process.env.OPENROUTER_TIMEOUT_MS, 30_000),
  },

  // Interview question count: a default plus the range the client may request.
  totalQuestions: 3,
  minQuestions: 2,
  maxQuestions: 6,

  // Interview focus presets the client may request. `mixed` is the default.
  interviewFocuses: ["mixed", "behavioral", "technical", "system-design"],

  // Input limits. The job description is re-sent to the model on every turn, so
  // keeping it bounded matters for both latency and cost.
  minJobDescriptionLength: 30,
  maxJobDescriptionLength: 8_000,
  maxAnswerLength: 5_000,
  // Optional resume pasted into the interview setup to sharpen questions.
  maxInterviewResumeLength: 6_000,

  // Resume text accepted by the Job Matches feature. Parsed client-side from a
  // PDF/text file, then sent here for profiling + per-job scoring.
  maxResumeLength: 20_000,
  minResumeLength: 120,

  // Adzuna job-search API (https://developer.adzuna.com) — the sole Job Matches
  // data source. Both keys are required; without them Job Matches returns a
  // warning and no jobs.
  adzuna: {
    appId: process.env.ADZUNA_APP_ID || "",
    appKey: process.env.ADZUNA_APP_KEY || "",
    // Adzuna is partitioned by country (a code in the request path). The client
    // picks one per search; this is only the fallback if a request omits it.
    country: (process.env.ADZUNA_COUNTRY || "us").toLowerCase(),
    // Every country Adzuna serves job listings for. Verified against the live
    // API. Keep in sync with ADZUNA_COUNTRIES in client/src/constants.js.
    supportedCountries: [
      "gb", "us", "at", "au", "be", "br", "ca", "ch", "de", "es",
      "fr", "in", "it", "mx", "nl", "nz", "pl", "sg", "za",
    ],
    // Adzuna returns salaries in each country's local currency with no currency
    // field, so map the country code → { locale, currency } for correct
    // formatting. Without this every salary rendered as USD.
    currencyByCountry: {
      gb: { locale: "en-GB", currency: "GBP" },
      us: { locale: "en-US", currency: "USD" },
      at: { locale: "de-AT", currency: "EUR" },
      au: { locale: "en-AU", currency: "AUD" },
      be: { locale: "nl-BE", currency: "EUR" },
      br: { locale: "pt-BR", currency: "BRL" },
      ca: { locale: "en-CA", currency: "CAD" },
      ch: { locale: "de-CH", currency: "CHF" },
      de: { locale: "de-DE", currency: "EUR" },
      es: { locale: "es-ES", currency: "EUR" },
      fr: { locale: "fr-FR", currency: "EUR" },
      in: { locale: "en-IN", currency: "INR" },
      it: { locale: "it-IT", currency: "EUR" },
      mx: { locale: "es-MX", currency: "MXN" },
      nl: { locale: "nl-NL", currency: "EUR" },
      nz: { locale: "en-NZ", currency: "NZD" },
      pl: { locale: "pl-PL", currency: "PLN" },
      sg: { locale: "en-SG", currency: "SGD" },
      za: { locale: "en-ZA", currency: "ZAR" },
    },
    baseUrl: "https://api.adzuna.com/v1/api",
  },

  // Job Matches tuning. Every pulled job costs one model call to score, so the
  // ceilings here bound total latency and spend for one search (/jobs/search
  // plus the /jobs/score batches the client then makes).
  jobMatch: {
    // Adzuna is now the only source, so this is the whole result pool.
    adzunaResultsPerPage: num(process.env.JOB_MATCH_ADZUNA_RESULTS, 20),
    // Search radius (km) around the user's city passed to Adzuna.
    adzunaDistanceKm: num(process.env.JOB_MATCH_ADZUNA_DISTANCE_KM, 60),
    // Hard cap on jobs scored by the model across one search (client scores them
    // in small batches, so this bounds the number of batch calls too).
    maxScored: num(process.env.JOB_MATCH_MAX_SCORED, 12),
    // Model scoring calls run in parallel, this many at a time (per batch).
    scoreConcurrency: num(process.env.JOB_MATCH_SCORE_CONCURRENCY, 4),
    // Jobs the client may ask to score in a single /api/jobs/score call.
    scoreBatchMax: num(process.env.JOB_MATCH_SCORE_BATCH_MAX, 4),
    // Per-IP requests/minute for /api/jobs (each fans out to several model calls).
    rateLimitMax: num(process.env.JOB_MATCH_RATE_LIMIT_MAX, 20),
    // Job scoring runs in its own model-call pool so a burst of Job Matches
    // traffic can never starve live interviews of the shared budget.
    modelConcurrency: num(process.env.JOB_MATCH_MODEL_CONCURRENCY, 4),
  },

  // Per-question answer time budget (seconds). The exact value for each question
  // is estimated from its text; these are the clamps.
  answerSeconds: { min: 60, max: 300 },

  // Browser origins allowed to call the API. Add your deployed client origin via
  // CLIENT_ORIGIN (comma-separated for more than one).
  corsOrigins: [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    ...(process.env.CLIENT_ORIGIN
      ? process.env.CLIENT_ORIGIN.split(",").map((s) => s.trim()).filter(Boolean)
      : []),
  ],

  // Optional bearer token. When set, every /api route except /api/health
  // requires `Authorization: Bearer <API_TOKEN>`. Leave unset for local dev;
  // set it for anything reachable off your machine.
  apiToken: process.env.API_TOKEN || "",

  // Express `trust proxy` setting — governs what the rate limiter treats as the
  // client IP. Only loosen this to match a proxy you actually run.
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),

  // Send HSTS (only meaningful when the app is served over HTTPS).
  forceHttps: process.env.FORCE_HTTPS === "true",

  // The read-only session-inspection route is a debugging aid; off by default.
  enableDebugRoutes: process.env.ENABLE_DEBUG_ROUTES === "true",

  // Per-IP rate limit for the interview endpoints (each one can trigger a paid
  // model call).
  rateLimit: {
    windowMs: 60_000,
    max: num(process.env.RATE_LIMIT_MAX, 30),
  },

  // Abuse / cost ceilings.
  limits: {
    // Hard cap on concurrently held in-memory sessions. New /start requests are
    // rejected with 503 past this until idle sessions age out.
    maxLiveSessions: num(process.env.MAX_LIVE_SESSIONS, 500),
    // Most OpenRouter calls we'll run at once for live interviews, process-wide.
    maxConcurrentModelCalls: num(process.env.MAX_CONCURRENT_MODEL_CALLS, 8),
    // Model calls per fixed 24h window across all callers and features (0 =
    // unlimited). Defaults to a generous backstop so a runaway loop or an abuser
    // rotating IPs can't run an unbounded OpenRouter bill; raise it for real
    // traffic or set 0 to disable.
    modelCallsPerDay: num(process.env.MODEL_CALLS_PER_DAY, 5_000),
    // Saved interviews kept per client id; oldest are dropped past this.
    maxInterviewsPerOwner: num(process.env.MAX_INTERVIEWS_PER_OWNER, 100),
  },

  // Where the flat-file history lives. Point this at a mounted volume in
  // deployments where the app directory is ephemeral.
  dataDir: process.env.DATA_DIR || "",

  // Sessions are dropped from memory after this many ms of inactivity.
  sessionTtlMs: 60 * 60 * 1000, // 1 hour
};

if (!config.openRouter.apiKey) {
  console.warn(
    "[config] OPENROUTER_API_KEY is not set. Add it to server/.env before calling the API."
  );
}

if (!config.apiToken) {
  console.warn(
    "[config] API_TOKEN is not set — the API is open to anyone who can reach it. " +
      "Set API_TOKEN for any non-local deployment."
  );
}

if (/:free\b/.test(config.model)) {
  console.warn(
    `[config] Model "${config.model}" is a free OpenRouter tier. Free models are ` +
      "heavily rate limited and may not support JSON response formatting, which " +
      "can make /feedback fail intermittently."
  );
}
