import { request } from "./client.js";
import { RESUME_REQUEST_TIMEOUT_MS } from "../constants.js";

/**
 * POST /api/resume/chat — one Resume Builder turn.
 *
 * Stateless: the whole conversation and the LIVE resume document go up every
 * time, so the model always edits what the user is currently looking at
 * (manual edits included) rather than a copy it remembers.
 *
 * `signal` lets the Stop button abort the in-flight request.
 *
 * @param {{ messages: Array<{role: string, content: string}>, resume: object,
 *           signal?: AbortSignal }} payload
 * @returns {Promise<{ reply: string, resume: object, changed: boolean }>}
 */
export function chatResume({ messages, resume, signal }) {
  return request("/resume/chat", {
    method: "POST",
    body: JSON.stringify({ messages, resume }),
    timeoutMs: RESUME_REQUEST_TIMEOUT_MS,
    signal,
  });
}
