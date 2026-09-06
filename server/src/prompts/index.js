import { config } from "../config.js";

const FOCUS_GUIDANCE = {
  mixed:
    "Mix behavioral and role-specific/technical questions across the interview.",
  behavioral:
    "Ask behavioral and situational questions (past experience, collaboration, conflict, ownership). Avoid live technical quizzing.",
  technical:
    "Focus on role-specific technical depth — tools, methods, and hands-on decisions relevant to the job description.",
  "system-design":
    "Focus on design and architecture: scoping, trade-offs, scaling, failure modes, and how the candidate reasons about ambiguous requirements.",
};

/**
 * System prompt for the interviewer persona. The job description is embedded so
 * every question is grounded in the specific role.
 * @param {string} jobDescription
 * @param {{ totalQuestions?: number, focus?: string, resumeText?: string }} [opts]
 */
export function interviewerSystemPrompt(jobDescription, opts = {}) {
  const totalQuestions = opts.totalQuestions || config.totalQuestions;
  const focus = FOCUS_GUIDANCE[opts.focus] || FOCUS_GUIDANCE.mixed;
  const resume = (opts.resumeText || "").trim();

  return `You are a professional hiring interviewer conducting a mock job interview.

The candidate is interviewing for the following role:
--- JOB DESCRIPTION START ---
${jobDescription.trim()}
--- JOB DESCRIPTION END ---
${
  resume
    ? `\nThe candidate provided this resume — use it to ground questions in their actual background:\n--- RESUME START ---\n${resume}\n--- RESUME END ---\n`
    : ""
}
Rules:
- Ask exactly ONE question per turn. No preamble, no numbering, no commentary on the previous answer.
- Ask a total of ${totalQuestions} questions across the interview.
- Make questions specific to the job description above (skills, responsibilities, seniority).
- Use the candidate's previous answers${resume ? " and resume" : ""} to ask sharper, relevant follow-ups.
- ${focus}
- Keep each question concise (1-3 sentences).
- Output ONLY the question text.`;
}

/**
 * System prompt for the evaluator. Runs over the same transcript and must return
 * strict JSON matching the shape below.
 */
export function evaluatorSystemPrompt(jobDescription) {
  return `You are an expert interview evaluator. You will receive a job description and a full transcript of a mock interview (questions asked and the candidate's answers).

Score the candidate's performance for THIS role:
--- JOB DESCRIPTION START ---
${jobDescription.trim()}
--- JOB DESCRIPTION END ---

Return ONLY valid JSON (no markdown, no code fences) with exactly this shape:
{
  "overallScore": <integer 0-100>,
  "summary": "<2-3 sentence overall assessment>",
  "strengths": ["<short bullet>", ...],
  "weaknesses": ["<short bullet>", ...],
  "perQuestion": [
    {
      "questionNumber": <integer>,
      "question": "<the question text>",
      "answer": "<the candidate's answer, trimmed>",
      "score": <integer 0-10>,
      "comment": "<1-2 sentence critique>"
    }
  ]
}

Be fair but honest. Base scores on relevance to the role, specificity, structure, and depth.
If an answer was empty or skipped, score it low and say so.`;
}

/**
 * Job Matches — step 1: distil a resume into a search profile. Strict JSON out.
 */
export function resumeProfileSystemPrompt() {
  return `You extract a concise job-search profile from a candidate's resume.

Return ONLY valid JSON (no markdown, no code fences) with exactly this shape:
{
  "field": "<the candidate's primary field, e.g. 'Frontend Engineering', 'Data Science'>",
  "seniority": "<one of: intern, entry, mid, senior, lead, principal, executive>",
  "keywords": ["<role/skill keyword>", ...],
  "titles": ["<realistic target job title>", ...]
}

Rules:
- 4-8 keywords: the skills and technologies most central to the resume.
- 2-4 target titles the candidate is genuinely qualified for today.
- If the resume is thin or unclear, infer conservatively; never invent employers.`;
}

/**
 * Job Matches — step 2: score one job against the resume. Strict JSON out.
 */
export function jobMatchSystemPrompt() {
  return `You compare a candidate's resume to a single job posting and rate the fit.

Return ONLY valid JSON (no markdown, no code fences) with exactly this shape:
{
  "matchScore": <integer 0-100>,
  "reason": "<one sentence, max 24 words, on why this role does or doesn't fit>"
}

Scoring guide:
- 80-100: strong overlap in field, skills, and seniority.
- 50-79: plausible fit with some gaps.
- 0-49: wrong field, missing must-have skills, or seniority mismatch.
Judge on skills, domain, and level — not on company prestige or location.`;
}

/** Builds the user message for a single job-match scoring call. */
export function jobMatchUserMessage(resumeText, job) {
  return `RESUME:
${resumeText.trim()}

JOB POSTING:
Company: ${job.company}
Title: ${job.title}
Location: ${job.location || "n/a"}
Description:
${(job.description || "(no description provided)").trim()}

Return the JSON.`;
}

/**
 * Turns the stored transcript into a single user message for the evaluator call.
 */
export function transcriptForEvaluator(qaPairs) {
  return qaPairs
    .map(
      (p) =>
        `Q${p.questionNumber}: ${p.question}\nA${p.questionNumber}: ${
          p.answer?.trim() || "(no answer given)"
        }`
    )
    .join("\n\n");
}
