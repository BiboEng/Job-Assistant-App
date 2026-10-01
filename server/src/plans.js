/**
 * The three plans — Regular (free), Pro and Ultimate — and what each allows.
 *
 * The single source of truth for plan limits. Pure data plus pure checks, no
 * imports, so the client's mirror (client/src/billing/plans.js) can be tested
 * against it (client/test/plans.test.js) and the Supabase trigger that caps
 * Application Tracker cards (supabase/migrations/20260930120000_user_subscriptions.sql)
 * can be checked for the same number.
 *
 * Every limit here is ENFORCED ON THE SERVER — in the interview, Job Matches,
 * Resume Builder, history and Progress controllers — except two things that
 * never reach the server: resume export formats (built in the browser, so the
 * lock is a UI lock) and Tracker cards (written straight to Supabase, so the
 * lock is a database trigger).
 *
 * Daily quotas count ACTIONS the user recognises (interviews started, job
 * searches run, AI messages sent in the Resume Builder), not raw model calls.
 * `modelCallsPerDay` is a separate, generous backstop on raw calls per user,
 * sized well above what the action quotas can legitimately use — it exists so
 * a scripted client hammering an unmetered endpoint (e.g. /api/jobs/score)
 * can't run up an unbounded bill.
 */

export const PLAN_IDS = ["regular", "pro", "ultimate"];

/** Plans that are bought through Stripe. */
export const PAID_PLAN_IDS = ["pro", "ultimate"];

/** Higher rank = more features. Used to pick the best of several subscriptions. */
export const PLAN_RANK = { regular: 0, pro: 1, ultimate: 2 };

export const ALL_FOCUSES = ["mixed", "behavioral", "technical", "system-design"];
export const ALL_EXPORTS = ["pdf-print", "pdf", "jpg", "png", "txt"];

/** The daily quotas, by the key used in usage counters. */
export const USAGE_KINDS = ["interviews", "jobSearches", "resumeMessages"];

export const PLANS = {
  regular: {
    id: "regular",
    name: "Regular",
    interviewsPerDay: 3,
    maxQuestions: 4,
    focuses: ["mixed", "behavioral"],
    speakMode: false,
    jobSearchesPerDay: 1,
    resumeMessagesPerDay: 20,
    exports: ["pdf-print", "txt"],
    progressInsights: false,
    trackerCards: 15,
    historyVisible: 10,
    strongerEvaluator: false,
    modelCallsPerDay: 150,
  },
  pro: {
    id: "pro",
    name: "Pro",
    interviewsPerDay: 15,
    maxQuestions: 6,
    focuses: ALL_FOCUSES,
    speakMode: true,
    jobSearchesPerDay: 5,
    resumeMessagesPerDay: 100,
    exports: ALL_EXPORTS,
    progressInsights: true,
    trackerCards: null, // unlimited
    historyVisible: 100,
    strongerEvaluator: false,
    modelCallsPerDay: 600,
  },
  ultimate: {
    id: "ultimate",
    name: "Ultimate",
    interviewsPerDay: 40,
    maxQuestions: 6,
    focuses: ALL_FOCUSES,
    speakMode: true,
    jobSearchesPerDay: 15,
    resumeMessagesPerDay: 300,
    exports: ALL_EXPORTS,
    progressInsights: true,
    trackerCards: null,
    historyVisible: 100,
    strongerEvaluator: true,
    modelCallsPerDay: 1500,
  },
};

/**
 * Used when billing isn't configured (no Stripe keys): the app behaves exactly
 * as it did before plans existed. Never sold, never shown.
 */
export const UNLIMITED_PLAN = {
  id: "unlimited",
  name: "Unlimited",
  interviewsPerDay: null,
  maxQuestions: 6,
  focuses: ALL_FOCUSES,
  speakMode: true,
  jobSearchesPerDay: null,
  resumeMessagesPerDay: null,
  exports: ALL_EXPORTS,
  progressInsights: true,
  trackerCards: null,
  historyVisible: null,
  strongerEvaluator: false,
  modelCallsPerDay: null,
};

export function planById(id) {
  return PLANS[id] || PLANS.regular;
}

export function isPaidPlan(id) {
  return PAID_PLAN_IDS.includes(id);
}

/** The daily limit for a usage kind, or null for unlimited. */
export function quotaFor(plan, kind) {
  if (kind === "interviews") return plan.interviewsPerDay ?? null;
  if (kind === "jobSearches") return plan.jobSearchesPerDay ?? null;
  if (kind === "resumeMessages") return plan.resumeMessagesPerDay ?? null;
  return null;
}

/** The cheapest plan that includes something, for "upgrade to X" wording. */
function cheapestPlanWith(test) {
  return PLAN_IDS.map((id) => PLANS[id]).find(test) || PLANS.ultimate;
}

const FOCUS_LABELS = {
  mixed: "Mixed",
  behavioral: "Behavioral",
  technical: "Technical",
  "system-design": "System design",
};

/**
 * Is this interview setup allowed on `plan`? Returns null when it is, or
 * `{ feature, requiredPlan, message }` naming the first thing that isn't.
 * `questionCount` / `focus` / `mode` are what the client asked for (already
 * validated as known values; a missing one means the default, which every
 * plan allows).
 */
export function checkInterviewSetup(plan, { questionCount, focus, mode } = {}) {
  if (mode === "speak" && !plan.speakMode) {
    const required = cheapestPlanWith((p) => p.speakMode);
    return {
      feature: "speakMode",
      requiredPlan: required.id,
      message: `Speak mode is part of ${required.name}. Switch to typing, or upgrade to answer out loud.`,
    };
  }
  if (focus != null && !plan.focuses.includes(focus)) {
    const required = cheapestPlanWith((p) => p.focuses.includes(focus));
    return {
      feature: "focus",
      requiredPlan: required.id,
      message: `${FOCUS_LABELS[focus] || "That"} interviews are part of ${required.name}. Pick another focus, or upgrade.`,
    };
  }
  const n = Math.round(Number(questionCount));
  if (questionCount != null && Number.isFinite(n) && n > plan.maxQuestions) {
    const required = cheapestPlanWith((p) => p.maxQuestions >= n);
    return {
      feature: "questionCount",
      requiredPlan: required.id,
      message: `${plan.name} interviews have up to ${plan.maxQuestions} questions. Choose fewer, or upgrade to ${required.name} for up to ${required.maxQuestions}.`,
    };
  }
  return null;
}

const QUOTA_WORDS = {
  interviews: { noun: "interviews", verb: "started" },
  jobSearches: { noun: "job searches", verb: "run" },
  resumeMessages: { noun: "Resume Builder AI messages", verb: "sent" },
};

/** The message for a used-up daily quota. */
export function quotaMessage(plan, kind) {
  const limit = quotaFor(plan, kind);
  const words = QUOTA_WORDS[kind] || { noun: "requests", verb: "made" };
  const next = PLAN_IDS.map((id) => PLANS[id]).find((p) => {
    const l = quotaFor(p, kind);
    return PLAN_RANK[p.id] > (PLAN_RANK[plan.id] ?? -1) && (l == null || l > (limit ?? 0));
  });
  const base = `You've ${words.verb} all ${limit} ${words.noun} included in ${plan.name} today. The count resets at midnight UTC.`;
  if (!next) return base;
  const nextLimit = quotaFor(next, kind);
  return `${base} ${next.name} includes ${nextLimit ?? "more"} a day.`;
}
