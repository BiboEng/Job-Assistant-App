import { request } from "./client.js";

export function startInterview(jobDescription, options = {}) {
  const { questionCount, focus, resumeText, mode } = options;
  return request("/interview/start", {
    method: "POST",
    body: JSON.stringify({
      jobDescription,
      ...(questionCount ? { questionCount } : {}),
      ...(focus ? { focus } : {}),
      ...(resumeText ? { resumeText } : {}),
      ...(mode ? { mode } : {}),
    }),
  });
}

/**
 * @param {object} [opts]
 * @param {number} [opts.questionNumber]  which question this answers. Lets the
 *   server recognise a re-sent answer it already took (the first attempt timed
 *   out on our side but succeeded on its) instead of filing it under the next
 *   question.
 * @param {boolean} [opts.timedOut]
 * @param {object|null} [opts.delivery]  speak mode only: the five numbers
 *   measured in the browser while this answer was spoken (pace, pause count and
 *   total, speaking time, on-camera percentage). Omitted entirely in type mode
 *   and whenever nothing could be measured — never any audio or video, which is
 *   never captured in the first place.
 */
export function submitAnswer(
  sessionId,
  answer,
  { questionNumber, timedOut = false, delivery } = {}
) {
  return request(`/interview/${encodeURIComponent(sessionId)}/answer`, {
    method: "POST",
    body: JSON.stringify({
      answer,
      ...(questionNumber ? { questionNumber } : {}),
      timedOut,
      ...(delivery ? { delivery } : {}),
    }),
  });
}

export function getFeedback(sessionId) {
  return request(`/interview/${encodeURIComponent(sessionId)}/feedback`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}
