import { request } from "./client.js";
import { JOBS_REQUEST_TIMEOUT_MS } from "../constants.js";

/**
 * POST /api/jobs/search — resume → search profile + a list of (unscored) jobs.
 * @param {{ resumeText: string, city: string, country: string }} payload
 * @returns {Promise<{ profile, jobs, warnings, message }>}
 */
export function searchJobs({ resumeText, city, country }) {
  return request("/jobs/search", {
    method: "POST",
    body: JSON.stringify({ resumeText, city, country }),
    timeoutMs: JOBS_REQUEST_TIMEOUT_MS,
  });
}

/**
 * POST /api/jobs/score — score one small batch of jobs against the resume.
 * The caller loops this a batch at a time so scores fill in progressively.
 * @param {{ resumeText: string, jobs: Array<object> }} payload
 * @returns {Promise<{ scores: Array<{ id, matchScore, reason }> }>}
 */
export function scoreJobs({ resumeText, jobs }) {
  return request("/jobs/score", {
    method: "POST",
    body: JSON.stringify({ resumeText, jobs }),
    timeoutMs: JOBS_REQUEST_TIMEOUT_MS,
  });
}
