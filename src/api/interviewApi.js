import { request } from "./client.js";

export function startInterview(jobDescription) {
  return request("/interview/start", {
    method: "POST",
    body: JSON.stringify({ jobDescription }),
  });
}

export function submitAnswer(sessionId, answer, { timedOut = false } = {}) {
  return request(`/interview/${encodeURIComponent(sessionId)}/answer`, {
    method: "POST",
    body: JSON.stringify({ answer, timedOut }),
  });
}

export function getFeedback(sessionId) {
  return request(`/interview/${encodeURIComponent(sessionId)}/feedback`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}
