import { config } from "../config.js";

/**
 * Process-wide ceilings on OpenRouter calls so a burst of traffic (or an abuser
 * who rotates past the per-IP limiter) can't run up an unbounded bill or pin the
 * event loop on dozens of in-flight fetches.
 *
 * Two independent concurrency pools:
 *   - "interview" — the live interview flow (start / answer / feedback)
 *   - "jobs"      — Job Matches profiling + scoring, which fans out widely
 * They don't share slots, so a rush of Job Matches traffic can never starve a
 * live interview of its budget (or vice versa). The daily call ceiling is global
 * across both.
 *
 * In-memory and single-process, like the rest of the app. Swap for a shared
 * counter if you run more than one instance.
 */

const pools = {
  interview: { inFlight: 0, max: () => config.limits.maxConcurrentModelCalls },
  jobs: { inFlight: 0, max: () => config.jobMatch.modelConcurrency },
};

let windowStart = Date.now();
let callsThisWindow = 0;

const DAY_MS = 24 * 60 * 60 * 1000;

function rollover() {
  if (Date.now() - windowStart >= DAY_MS) {
    windowStart = Date.now();
    callsThisWindow = 0;
  }
}

function budgetError(message, status) {
  const err = new Error(message);
  err.status = status;
  err.expose = true;
  return err;
}

/**
 * Runs `fn` if there's headroom in the given pool, otherwise throws a user-safe
 * 503.
 * @param {() => Promise<T>} fn
 * @param {{ kind?: "interview" | "jobs" }} [opts]
 * @returns {Promise<T>}
 */
export async function withModelBudget(fn, { kind = "interview" } = {}) {
  rollover();

  const pool = pools[kind] || pools.interview;
  const { modelCallsPerDay } = config.limits;

  if (modelCallsPerDay > 0 && callsThisWindow >= modelCallsPerDay) {
    throw budgetError(
      "The service has hit its daily capacity. Please try again later.",
      503
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
    callsThisWindow,
    windowStart,
  };
}
