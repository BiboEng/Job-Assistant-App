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

  // How the candidate answers. "type" is the default and the historical
  // behaviour; "speak" additionally collects browser-side delivery metrics
  // (pace, pauses, on-camera time) and feeds them to the evaluator.
  interviewModes: ["type", "speak"],

  // Bounds for the delivery metrics a speak-mode client reports per answer.
  // They're estimates measured in the browser, so they're clamped rather than
  // trusted — see normalizeDelivery in interview.controller.js.
  delivery: {
    minWpm: 20,
    maxWpm: 400,
    maxPauseCount: 100,
    // 10 minutes — past the mic's own 5-minute cap even with a re-record.
    maxPauseMs: 600_000,
    maxSpeakingMs: 600_000,
  },

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

  // Resume Builder. The chat is stateless — the client re-sends the history and
  // the live resume document on every turn — so these caps bound both the
  // request body (express.json is 64kb) and the per-call token cost.
  // maxHistoryMessages * maxMessageLength + maxResumeJsonLength must stay under
  // that 64kb ceiling with room to spare.
  resume: {
    // Chat turns re-sent to the model (oldest are dropped past this).
    maxHistoryMessages: num(process.env.RESUME_MAX_HISTORY, 14),
    // Per-message cap on the chat text.
    maxMessageLength: num(process.env.RESUME_MAX_MESSAGE_LENGTH, 2_000),
    // Serialized resume JSON accepted from the client.
    maxResumeJsonLength: num(process.env.RESUME_MAX_JSON_LENGTH, 20_000),
    // Per-IP requests/minute for /api/resume.
    rateLimitMax: num(process.env.RESUME_RATE_LIMIT_MAX, 30),
    // Its own model-call pool, so resume chatter can't starve live interviews.
    modelConcurrency: num(process.env.RESUME_MODEL_CONCURRENCY, 4),
  },

  // Progress. Two kinds of model call: naming each saved interview's role (a
  // batch of job descriptions per call, once per interview, then stored on the
  // record) and aggregating one role's feedback into recurring themes (cached
  // in memory per owner + role + interview set). Both run in their own pool.
  progress: {
    // Per-IP requests/minute for /api/progress.
    rateLimitMax: num(process.env.PROGRESS_RATE_LIMIT_MAX, 30),
    // Its own model-call pool, so Progress can't starve live interviews.
    modelConcurrency: num(process.env.PROGRESS_MODEL_CONCURRENCY, 2),
    // Job descriptions named per role-label call.
    labelBatchSize: num(process.env.PROGRESS_LABEL_BATCH_SIZE, 10),
    // Role-label calls one GET /api/progress may make to backfill unlabelled
    // history. Anything left over is labelled on a later visit; until then it
    // is grouped by the job description's first line.
    maxLabelCallsPerRequest: num(process.env.PROGRESS_MAX_LABEL_CALLS, 2),
    // How long GET /api/progress waits on that labelling before answering with
    // the first-line grouping (and `labelling: true`) — well inside the
    // client's request timeout. Labelling carries on in the background.
    labelWaitMs: num(process.env.PROGRESS_LABEL_WAIT_MS, 20_000),
    // After a role-label call fails, don't retry for this owner for this long —
    // otherwise every visit to Progress re-spends a call on a broken model.
    labelRetryAfterMs: num(process.env.PROGRESS_LABEL_RETRY_MS, 5 * 60 * 1000),
    // Most recent interviews per role whose feedback feeds the themes call.
    maxThemeInterviews: num(process.env.PROGRESS_MAX_THEME_INTERVIEWS, 12),
    // Aggregated-theme results kept in memory (oldest evicted first).
    themeCacheMax: num(process.env.PROGRESS_THEME_CACHE_MAX, 500),
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

  // Optional shared token. When set, every /api route except /api/health
  // requires it in the `X-Api-Token` header. It ships in the built client, so
  // it only keeps casual traffic out — the per-user boundary is `supabase`
  // below.
  apiToken: process.env.API_TOKEN || "",

  // Verifying Supabase sign-ins. With SUPABASE_URL set (the same project URL
  // the client uses — public, not a secret) every /api route except
  // /api/health needs the caller's Supabase access token, and history is
  // scoped to the VERIFIED user rather than to a header the client names.
  // SUPABASE_JWT_SECRET is only for legacy projects still signing with HS256;
  // current projects publish ES256 keys at <url>/auth/v1/.well-known/jwks.json.
  // Unset both = legacy mode: the owner is taken from `X-Client-Id` on faith.
  supabase: {
    url: (process.env.SUPABASE_URL || "").trim().replace(/\/+$/, ""),
    jwtSecret: process.env.SUPABASE_JWT_SECRET || "",
    audience: "authenticated",
  },

  // Plans & billing (Stripe). Switched on only when ALL of the following are
  // set: a Stripe API key, the webhook signing secret, at least one price, the
  // Supabase URL (so the payer is a verified user, not a header) and the
  // Supabase service-role key (so the server can record who has paid). With
  // any of them missing, billing is off and every user gets the app exactly
  // as it was before plans existed — see billingStatus() below.
  billing: {
    // A restricted key (rk_…) with only the permissions the integration uses
    // is preferred over the full secret key (sk_…) — see BILLING.md.
    stripeKey: (process.env.STRIPE_SECRET_KEY || "").trim(),
    webhookSecret: (process.env.STRIPE_WEBHOOK_SECRET || "").trim(),
    // Stripe Price ids (price_…). One Product per plan; monthly and (optional)
    // yearly Prices on each.
    prices: {
      pro: {
        month: (process.env.STRIPE_PRICE_PRO_MONTHLY || "").trim(),
        year: (process.env.STRIPE_PRICE_PRO_YEARLY || "").trim(),
      },
      ultimate: {
        month: (process.env.STRIPE_PRICE_ULTIMATE_MONTHLY || "").trim(),
        year: (process.env.STRIPE_PRICE_ULTIMATE_YEARLY || "").trim(),
      },
    },
    // Stripe Tax. Only turn on once Stripe → Tax has a head-office address AND
    // at least one active registration — without a registration it silently
    // collects nothing. See BILLING.md → "Sales tax".
    automaticTax: process.env.STRIPE_AUTOMATIC_TAX === "true",
    // Where Checkout and the billing portal send the browser back to. The
    // deployed client origin, e.g. https://jobassist.example.com.
    appUrl: (process.env.APP_URL || "http://localhost:5173").trim().replace(/\/+$/, ""),
    // Server-only secret. NEVER put this in client/.env: Vite bundles every
    // SUPABASE_* variable there into the browser.
    supabaseServiceRoleKey: (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim(),
    // How long a user's plan is cached before re-reading Supabase. A webhook
    // clears the entry immediately, so this only bounds staleness if one is
    // missed.
    planCacheMs: num(process.env.BILLING_PLAN_CACHE_MS, 60_000),
    // Ultimate's "stronger model for feedback". Unset = Ultimate uses the
    // default model for feedback too.
    ultimateEvaluatorModel: (process.env.ULTIMATE_EVALUATOR_MODEL || "").trim(),
    // Local testing only: with billing OFF, give every user this plan's
    // limits ("regular" | "pro" | "ultimate") instead of no limits. Ignored
    // whenever billing is on, so it can't leak into production.
    devPlan: (process.env.DEV_PLAN || "").trim().toLowerCase(),
  },

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
    // The same, per owner (signed-in user), so one account can't spend the
    // whole global allowance. A Job Matches search is ~13 calls and an
    // interview 3–8, so this is generous for real use. 0 = no per-user cap.
    // Once plans apply (billing on, or DEV_PLAN) each plan has its own
    // backstop instead (`modelCallsPerDay` in src/plans.js), and this one
    // counts only when set explicitly — then as a ceiling over every plan.
    modelCallsPerUserPerDay: num(process.env.MODEL_CALLS_PER_USER_PER_DAY, 300),
    modelCallsPerUserPerDayExplicit: Boolean(process.env.MODEL_CALLS_PER_USER_PER_DAY),
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

if (!config.supabase.url && !config.supabase.jwtSecret) {
  console.warn(
    "[config] SUPABASE_URL is not set — sign-ins are NOT verified, and history is " +
      "scoped by the client-supplied X-Client-Id header. Set SUPABASE_URL for any " +
      "non-local deployment."
  );
}

/**
 * Whether plans are enforced and Stripe is live, and if not, why not. Every
 * requirement is listed so a half-configured deployment says exactly what's
 * missing instead of quietly running with no limits.
 */
export function billingStatus(c = config) {
  const b = c.billing;
  const missing = [];
  if (!b.stripeKey) missing.push("STRIPE_SECRET_KEY");
  if (!b.webhookSecret) missing.push("STRIPE_WEBHOOK_SECRET");
  if (!b.prices.pro.month && !b.prices.ultimate.month) {
    missing.push("STRIPE_PRICE_PRO_MONTHLY or STRIPE_PRICE_ULTIMATE_MONTHLY");
  }
  if (!c.supabase.url) missing.push("SUPABASE_URL");
  if (!b.supabaseServiceRoleKey) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  // Nothing Stripe-related set at all is "billing not in use", not a mistake.
  const attempted = Boolean(
    b.stripeKey || b.webhookSecret || b.prices.pro.month || b.prices.ultimate.month
  );
  return { enabled: missing.length === 0, attempted, missing };
}

{
  const status = billingStatus();
  if (status.attempted && !status.enabled) {
    console.warn(
      `[config] Billing is partly configured but OFF — missing: ${status.missing.join(", ")}. ` +
        "Until every one is set, plans aren't enforced and checkout is disabled."
    );
  }
  if (status.enabled && /^sk_live_/.test(config.billing.stripeKey)) {
    console.warn(
      "[config] STRIPE_SECRET_KEY is a full live secret key. Prefer a restricted key " +
        "(rk_live_…) with only the permissions listed in BILLING.md."
    );
  }
  if (status.enabled && config.billing.devPlan) {
    console.warn("[config] DEV_PLAN is ignored because billing is on.");
  }
}

if (/:free\b/.test(config.model)) {
  console.warn(
    `[config] Model "${config.model}" is a free OpenRouter tier. Free models are ` +
      "heavily rate limited and may not support JSON response formatting, which " +
      "can make /feedback fail intermittently."
  );
}
