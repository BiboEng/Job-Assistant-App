import {
  MIN_JD_LENGTH,
  MAX_JD_LENGTH,
  QUESTION_COUNT_MIN,
  QUESTION_COUNT_MAX,
  QUESTION_COUNT_DEFAULT,
  INTERVIEW_FOCUSES,
  INTERVIEW_MODES,
  DEFAULT_INTERVIEW_MODE,
} from "../constants.js";

/**
 * "Practice again": the settings to start a fresh interview in the same format
 * as an earlier one — same job description, question count, focus and answer
 * mode. Pure, unit-tested.
 *
 * Takes either a saved history record (`totalQuestions`) or the setup a live
 * session was started with (`questionCount`). Every field is re-validated
 * against today's limits, because history can predate them: an unknown focus
 * or mode falls back to the default rather than being sent for the server to
 * reject. A job description that no longer passes the length check can't be
 * repeated at all — null — rather than silently truncated into a different
 * interview.
 *
 * The optional resume paste is not part of it: saved interviews don't keep it.
 *
 * @param {object|null|undefined} source
 * @returns {{ jobDescription: string, questionCount: number, focus: string,
 *   mode: "type" | "speak" } | null}
 */
export function repeatSettings(source) {
  if (!source || typeof source !== "object") return null;
  const jobDescription = typeof source.jobDescription === "string" ? source.jobDescription.trim() : "";
  if (jobDescription.length < MIN_JD_LENGTH || jobDescription.length > MAX_JD_LENGTH) return null;

  const rawCount = Math.round(Number(source.questionCount ?? source.totalQuestions));
  const questionCount = Number.isFinite(rawCount)
    ? Math.min(QUESTION_COUNT_MAX, Math.max(QUESTION_COUNT_MIN, rawCount))
    : QUESTION_COUNT_DEFAULT;

  const focus = INTERVIEW_FOCUSES.some((f) => f.value === source.focus)
    ? source.focus
    : INTERVIEW_FOCUSES[0].value;

  const mode = INTERVIEW_MODES.some((m) => m.value === source.mode)
    ? source.mode
    : DEFAULT_INTERVIEW_MODE;

  return { jobDescription, questionCount, focus, mode };
}

/** The posting's first non-empty line — what the results page is titled with. */
export function roleHeadline(jobDescription) {
  return (String(jobDescription ?? "").split("\n").find((l) => l.trim()) || "")
    .trim()
    .slice(0, 80);
}
