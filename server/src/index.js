import express from "express";
import cors from "cors";
import { billingStatus, config } from "./config.js";
import { interviewRouter } from "./routes/interview.routes.js";
import { interviewsRouter } from "./routes/interviews.routes.js";
import { jobsRouter } from "./routes/jobs.routes.js";
import { resumeRouter } from "./routes/resume.routes.js";
import { progressRouter } from "./routes/progress.routes.js";
import { billingRouter } from "./routes/billing.routes.js";
import { getPlanCatalog, stripeWebhook } from "./controllers/billing.controller.js";
import { rateLimit } from "./middleware/rateLimit.js";
import { requireApiToken, authenticate } from "./middleware/auth.js";
import { attachPlan } from "./middleware/plan.js";
import { ensureHistoryReady } from "./services/history.service.js";

const app = express();

app.disable("x-powered-by");
// Governs what `req.ip` resolves to behind a proxy — keep this matched to your
// actual deployment (loopback-only by default). See config.js.
app.set("trust proxy", config.trustProxy);

// Restrict CORS to known client origins (configurable via CLIENT_ORIGIN). A
// disallowed browser origin simply gets no CORS headers (the browser then blocks
// the response) rather than a 500.
app.use(
  cors({
    origin(origin, cb) {
      if (!origin || config.corsOrigins.includes(origin)) return cb(null, true);
      return cb(null, false);
    },
  })
);

// Baseline security headers (kept dependency-free). The API only ever returns
// JSON, so the CSP can be maximally strict.
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader(
    "Permissions-Policy",
    "geolocation=(), camera=(), microphone=(), payment=(), usb=()"
  );
  res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  if (config.forceHttps) {
    res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
  }
  next();
});

// Stripe webhooks. Mounted BEFORE express.json: the signature covers the exact
// bytes Stripe sent, so the body must reach the handler unparsed. No user
// token or API token — Stripe's signature (STRIPE_WEBHOOK_SECRET) is the
// authentication. Its own rate limit is generous: Stripe can burst events.
app.post(
  "/api/billing/webhook",
  rateLimit({ windowMs: config.rateLimit.windowMs, max: 300 }),
  express.raw({ type: "application/json", limit: "1mb" }),
  stripeWebhook
);

app.use(express.json({ limit: "64kb", strict: true }));

// Public: which paid prices are on sale, read from Stripe, for the landing
// page's "More features" section. No sign-in — visitors see prices before
// they have an account.
app.get(
  "/api/billing/plans",
  rateLimit({ windowMs: config.rateLimit.windowMs, max: 60 }),
  getPlanCatalog
);

app.get(
  "/api/health",
  rateLimit({ windowMs: config.rateLimit.windowMs, max: 120 }),
  (_req, res) => {
    res.json({ ok: true, model: config.model });
  }
);

app.use(
  "/api/interview",
  rateLimit({ windowMs: config.rateLimit.windowMs, max: config.rateLimit.max }),
  requireApiToken,
  authenticate,
  attachPlan,
  interviewRouter
);

// History endpoints are cheap (file reads), so they get a looser limit.
app.use(
  "/api/interviews",
  rateLimit({ windowMs: config.rateLimit.windowMs, max: 100 }),
  requireApiToken,
  authenticate,
  attachPlan,
  interviewsRouter
);

// Job Matches (/search + /score). Each request fans out to several model calls
// in the separate "jobs" budget pool; it sits behind the same auth + client-id
// scoping as everything else.
app.use(
  "/api/jobs",
  rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.jobMatch.rateLimitMax,
  }),
  requireApiToken,
  authenticate,
  attachPlan,
  jobsRouter
);

// Resume Builder chat. One model call per turn, in the separate "resume" budget
// pool, behind the same auth + per-IP rate limit as everything else.
app.use(
  "/api/resume",
  rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.resume.rateLimitMax,
  }),
  requireApiToken,
  authenticate,
  attachPlan,
  resumeRouter
);

// Progress: history grouped by role + recurring feedback themes. Its model
// calls (role labels, themes) run in the separate "progress" budget pool.
app.use(
  "/api/progress",
  rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.progress.rateLimitMax,
  }),
  requireApiToken,
  authenticate,
  attachPlan,
  progressRouter
);

// Plans & billing for the signed-in user: current plan + usage, checkout,
// the billing portal, and a re-check after returning from Checkout.
app.use(
  "/api/billing",
  rateLimit({ windowMs: config.rateLimit.windowMs, max: 60 }),
  requireApiToken,
  authenticate,
  attachPlan,
  billingRouter
);

// 404
app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Central error handler. 4xx messages (and errors explicitly marked safe) are
// passed to the client; everything else is logged and returned generically so we
// never leak upstream/internal detail.
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = (err && Number(err.status)) || 500;
  if (status >= 500) console.error("[error]", err);

  // A malformed JSON body is a 400 from body-parser whose message is the raw
  // parser output — say it plainly instead of echoing that.
  if (err?.type === "entity.parse.failed") {
    return res.status(400).json({ error: "The request body is not valid JSON." });
  }

  const message =
    err && typeof err.message === "string" ? err.message : "";
  const safe = status < 500 || (err && err.expose === true);
  res.status(status).json({
    error: safe && message ? message : "Something went wrong. Please try again.",
  });
});

ensureHistoryReady().catch((err) =>
  console.error("[history] init failed:", err)
);

app.listen(config.port, () => {
  console.log(`Mock interview API listening on http://localhost:${config.port}`);
  console.log(`Model: ${config.model}`);
  console.log(`Billing: ${billingStatus().enabled ? "on (plans enforced)" : "off (no plan limits)"}`);
});
