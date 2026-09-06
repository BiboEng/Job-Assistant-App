import { request } from "./client.js";

export function startInterview(jobDescription, options = {}) {
  const { questionCount, focus, resumeText } = options;
  return request("/interview/start", {
    method: "POST",
    body: JSON.stringify({
      jobDescription,
      ...(questionCount ? { questionCount } : {}),
      ...(focus ? { focus } : {}),
      ...(resumeText ? { resumeText } : {}),
    }),
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
