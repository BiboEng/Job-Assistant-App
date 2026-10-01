import { AsyncLocalStorage } from "node:async_hooks";
import { config } from "../config.js";

/**
 * Process-wide ceilings on OpenRouter calls so a burst of traffic (or an abuser
 * who rotates past the per-IP limiter) can't run up an unbounded bill or pin the
 * event loop on dozens of in-flight fetches.
 *
 * Four independent concurrency pools:
 *   - "interview" — the live interview flow (start / answer / feedback)
 *   - "jobs"      — Job Matches profiling + scoring, which fans out widely
 *   - "resume"    — Resume Builder chat turns
 *   - "progress"  — Progress role labels + recurring feedback themes
 * They don't share slots, so a rush of Job Matches or Resume Builder traffic can
 * never starve a live interview of its budget (or vice versa). The daily call
 * ceiling is global across all four.
 *
 * On top of that each owner (signed-in user) has their own daily allowance,
 * `MODEL_CALLS_PER_USER_PER_DAY`, so one account can't spend the whole day's
 * global budget for everyone else. The owner comes from the request context
 * `authenticate` opens (`runWithOwner`), which follows the request through
 * every await — so background work a request starts (Progress role labelling
 * after a save) is billed to the same owner.
 *
 * In-memory and single-process, like the rest of the app. Swap for a shared
 * counter if you run more than one instance.
 */

const pools = {
  interview: { inFlight: 0, max: () => config.limits.maxConcurrentModelCalls },
  jobs: { inFlight: 0, max: () => config.jobMatch.modelConcurrency },
  resume: { inFlight: 0, max: () => config.resume.modelConcurrency },
  progress: { inFlight: 0, max: () => config.progress.modelConcurrency },
};

let windowStart = Date.now();
let callsThisWindow = 0;
const callsByOwner = new Map(); // ownerId -> calls this window

const DAY_MS = 24 * 60 * 60 * 1000;

const ownerContext = new AsyncLocalStorage();

/** Runs `fn` with `ownerId` as the owner that model calls inside it bill to. */
export function runWithOwner(ownerId, fn) {
  return ownerContext.run({ ownerId: ownerId || null, callLimit: null }, fn);
}

/**
 * Sets the current owner's daily model-call ceiling for the rest of this
 * request (and anything it starts). `attachPlan` calls it with the plan's
 * backstop; null keeps MODEL_CALLS_PER_USER_PER_DAY.
 */
export function setOwnerCallLimit(limit) {
  const store = ownerContext.getStore();
  if (store) store.callLimit = Number.isFinite(limit) ? limit : null;
}

function rollover() {
  if (Date.now() - windowStart >= DAY_MS) {
    windowStart = Date.now();
    callsThisWindow = 0;
    callsByOwner.clear();
  }
}

function budgetError(message, status) {
  const err = new Error(message);
  err.status = status;
  err.expose = true;
  return err;
}

/**
 * Runs `fn` if there's headroom, otherwise throws a user-safe error: 429 when
 * the caller has used up their own daily allowance, 503 when the service as a
 * whole is at capacity.
 * @param {() => Promise<T>} fn
 * @param {{ kind?: "interview" | "jobs" | "resume" | "progress" }} [opts]
 * @returns {Promise<T>}
 */
export async function withModelBudget(fn, { kind = "interview" } = {}) {
  rollover();

  const pool = pools[kind] || pools.interview;
  const { modelCallsPerDay } = config.limits;
  const store = ownerContext.getStore();
  const ownerId = store?.ownerId ?? null;
  const modelCallsPerUserPerDay = store?.callLimit ?? config.limits.modelCallsPerUserPerDay;

  if (modelCallsPerDay > 0 && callsThisWindow >= modelCallsPerDay) {
    throw budgetError(
      "The service has hit its daily capacity. Please try again later.",
      503
    );
  }
  if (
    ownerId &&
    modelCallsPerUserPerDay > 0 &&
    (callsByOwner.get(ownerId) ?? 0) >= modelCallsPerUserPerDay
  ) {
    throw budgetError(
      "You've reached today's limit for AI requests. Please come back tomorrow.",
      429
    );
  }
  if (pool.inFlight >= pool.max()) {
    throw budgetError(
      "The service is busy right now. Please try again in a moment.",
      503
    );
  }

  pool.inFlight += 1;
  callsThisWindow += 1;
  if (ownerId) callsByOwner.set(ownerId, (callsByOwner.get(ownerId) ?? 0) + 1);
  try {
    return await fn();
  } finally {
    pool.inFlight -= 1;
  }
}

export function budgetSnapshot() {
  rollover();
  return {
    interviewInFlight: pools.interview.inFlight,
    jobsInFlight: pools.jobs.inFlight,
    resumeInFlight: pools.resume.inFlight,
    progressInFlight: pools.progress.inFlight,
    callsThisWindow,
    windowStart,
    owners: callsByOwner.size,
  };
}
