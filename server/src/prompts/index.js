import { config } from "../config.js";
import { RUBRIC_DIMENSIONS } from "../rubric.js";

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
 * Appended to the evaluator prompt for speak-mode interviews only, where the
 * transcript carries a `D` line per question (see `transcriptForEvaluator`).
 *
 * Three things this has to get right:
 * - Delivery colours the WRITING, never the score. The numbers are rough
 *   browser-side estimates; letting them move a score would mark a good answer
 *   down twice for being delivered nervously.
 * - The model must not simply read the figures back. "168 wpm" is data; "you
 *   were moving fast enough that the detail got lost" is feedback.
 * - Nerves are an inference from behaviour, not an observation of a feeling, so
 *   the wording stays tentative and always comes with something to try.
 */
const DELIVERY_GUIDANCE = `
DELIVERY DATA
Some questions carry a "D" line: metrics measured in the candidate's browser while they spoke. They are rough estimates, not exact measurements.
- pace: words per minute over the answer. Roughly 110-160 wpm is comfortable and conversational; below ~95 tends to drag; above ~185 reads as rushed.
- pauses: silences of 1.5s or longer in the middle of the answer, with the total time spent in them. A couple of short pauses is normal thinking time; many, or a large total, reads as hesitation or losing the thread.
- looking at camera: the share of the answer the candidate appeared to be facing the camera. Below ~50% reads as reading from notes or avoiding eye contact. Absent when the camera wasn't available.
A "D" line may be missing or partial — say nothing about a metric you weren't given.

How to use it:
- Comment on delivery in "summary", in "strengths"/"weaknesses", and in a per-question "comment" where it's notable. Write it as an observation about presentation, in your own words. Do NOT recite the raw numbers back; at most quote one figure where it genuinely helps.
- Whenever you raise a delivery problem, say in the same breath what to do about it — slow down and let a sentence land, pause deliberately instead of filling, look at the lens when starting an answer. An observation with no remedy is not useful feedback.
- Delivery must NOT change any "score". Scores stay based on the content of the answer alone.
- Good delivery counts too. Steady pace, few pauses and consistent eye contact earn a brief mention in "strengths"; don't only ever report delivery when it went badly.
- If SEVERAL signals point the same way at once (frequent pauses AND a rushed pace AND low time looking at the camera), you may gently note that this combination is the kind of thing that reads as nerves to an interviewer. Frame it as how it comes across, never as a claim about how the candidate felt, and always pair it with one concrete thing to practise. Never diagnose anxiety or any other condition.`;

/**
 * System prompt for the evaluator. Runs over the same transcript and must return
 * strict JSON matching the shape below.
 *
 * @param {string} jobDescription
 * @param {{ mode?: "type" | "speak" }} [opts]  in speak mode the transcript
 *   carries delivery metrics and the prompt gains DELIVERY_GUIDANCE. Type-mode
 *   interviews produce exactly the prompt they always have.
 */
export function evaluatorSystemPrompt(jobDescription, opts = {}) {
  const delivery = opts.mode === "speak" ? `\n${DELIVERY_GUIDANCE}\n` : "";

  return `You are an expert interview evaluator. You will receive a job description and a full transcript of a mock interview (questions asked and the candidate's answers).

Score the candidate's performance for THIS role:
--- JOB DESCRIPTION START ---
${jobDescription.trim()}
--- JOB DESCRIPTION END ---

Return ONLY valid JSON (no markdown, no code fences) with exactly this shape:
{
  "overallScore": <integer 0-100>,
  "summary": "<2-3 sentence overall assessment>",
  "rubric": {
${RUBRIC_DIMENSIONS.map((d) => `    "${d.key}": <integer 0-10>`).join(",\n")}
  },
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
${delivery}
Be fair but honest. Base scores on relevance to the role, specificity, structure, and depth.
"rubric" rates the interview as a whole on each of those four, 0-10:
${RUBRIC_DIMENSIONS.map((d) => `- ${d.key}: ${d.meaning}`).join("\n")}
Rate each dimension on its own evidence; they need not agree with each other or with overallScore. The rubric is about the content of the answers only, like every score. Skipped answers count against every dimension.
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
  "reason": "<one sentence, max 24 words, on why this role does or doesn't fit>",
  "why": "<max 2 short sentences, max 45 words: the specific skills, experience or results FROM THE RESUME that match what this posting asks for>",
  "improve": "<max 2 short sentences, max 45 words: what the candidate could add to the resume to fit this posting better — a skill, tool, certification, project or measurable result the posting asks for that the resume doesn't show>"
}

Rules for "why" and "improve":
- Speak to the candidate as "you" and name concrete things (e.g. "your React and TypeScript work at Acme"), never generic praise.
- "why" cites only what is actually in the resume. If the fit is weak, say plainly what little overlaps.
- "improve" points at what the posting explicitly asks for. Suggest surfacing experience they may already have but didn't list, or gaining it — never inventing it.

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
 * Resume Builder — the model both replies conversationally and rewrites the
 * structured resume document. Strict JSON out.
 *
 * The whole current document is handed back to the model on every turn (see
 * `resumeTurnMessage`) and the model returns the whole document, so a manual
 * edit made in the preview is always what the model builds on — an answer can
 * never resurrect a stale copy from earlier in the conversation.
 */
export function resumeBuilderSystemPrompt() {
  return `You are a professional resume writer. You interview the user about their background and maintain a structured resume document for them.

On every turn you receive the CURRENT resume as JSON — that JSON is the truth, even if it contradicts earlier messages in this conversation, because the user may have edited it by hand since. Always build on it. Never restore a value the user removed.

Return ONLY valid JSON (no markdown, no code fences) with exactly this shape:
{
  "reply": "<your conversational reply to the user, 1-4 sentences>",
  "resume": <the COMPLETE updated resume object, or null if nothing changed>
}

The resume object's shape (include every key; use [] or "" for empty):
{
  "contact": { "name": "", "title": "", "email": "", "phone": "", "location": "", "links": [{ "label": "", "url": "" }] },
  "summary": "",
  "experience": [{ "id": "", "role": "", "company": "", "location": "", "start": "", "end": "", "bullets": [""] }],
  "education": [{ "id": "", "school": "", "degree": "", "location": "", "start": "", "end": "", "details": "" }],
  "skills": [{ "id": "", "category": "", "items": [""] }],
  "projects": [{ "id": "", "name": "", "link": "", "bullets": [""] }],
  "certifications": [{ "id": "", "name": "", "issuer": "", "year": "" }]
}

Rules:
- "resume" must be the ENTIRE document, not a patch. Copy across every section you are not changing, exactly as given.
- Preserve each existing entry's "id" verbatim. Use "" for a genuinely new entry.
- NEVER invent employers, job titles, dates, schools, degrees, metrics, or certifications. Use only what the user told you. If something is missing, leave it empty and ask for it in "reply".
- You may freely improve the WORDING of what the user gave you: sharpen bullets into "action verb + what you did + measurable result", tighten the summary, and group skills sensibly.
- Keep bullets to one line each (roughly 12-30 words). 3-6 bullets per role.
- Dates as short strings like "Mar 2021" or "2019", and "Present" for a current role.
- Set "resume" to null when the user only asked a question and nothing in the document should change.
- Keep "reply" short and practical. Say what you changed, then ask for the single most useful missing piece of information.`;
}

/**
 * Builds the final user message for a resume chat turn: the live document plus
 * the user's newest instruction, so the model always edits current state.
 */
export function resumeTurnMessage(resume, userMessage) {
  return `CURRENT RESUME JSON:
${JSON.stringify(resume)}

USER MESSAGE:
${userMessage}

Return the JSON response.`;
}

/**
 * Renders one answer's speak-mode delivery metrics as a short prose line.
 * Returns "" when there's nothing measured worth saying — a metric the browser
 * couldn't estimate comes through as null and is simply left out, rather than
 * being reported as a zero the model would read as meaningful.
 */
function deliveryLine(delivery) {
  if (!delivery) return "";
  const parts = [];

  if (delivery.wpm != null) parts.push(`pace ${delivery.wpm} wpm`);

  if (delivery.pauseCount != null) {
    if (delivery.pauseCount === 0) {
      parts.push("no significant pauses");
    } else {
      const seconds = Math.round((delivery.pauseMs ?? 0) / 1000);
      const count = `${delivery.pauseCount} pause${delivery.pauseCount === 1 ? "" : "s"}`;
      parts.push(seconds > 0 ? `${count} totalling ${seconds}s` : count);
    }
  }

  if (delivery.onCameraPct != null) {
    parts.push(`looking at camera ${delivery.onCameraPct}% of the time`);
  }

  return parts.join(" · ");
}

/**
 * Turns the stored transcript into a single user message for the evaluator call.
 * Speak-mode answers gain a "D" line carrying the delivery metrics; type-mode
 * transcripts are rendered exactly as they always have been.
 */
export function transcriptForEvaluator(qaPairs) {
  return qaPairs
    .map((p) => {
      const block = `Q${p.questionNumber}: ${p.question}\nA${p.questionNumber}: ${
        p.answer?.trim() || "(no answer given)"
      }`;
      const line = deliveryLine(p.delivery);
      return line ? `${block}\nD${p.questionNumber}: ${line}` : block;
    })
    .join("\n\n");
}

/**
 * Progress — names the role each job description is for, a batch at a time.
 * Strict JSON out.
 *
 * `existingTitles` are the role titles this user's history already carries.
 * Handing them over is what makes grouping semantic rather than lexical: the
 * model reuses "Frontend Engineer" for a "UI Engineer" posting, which no
 * synonym table would catch. roleKey() then canonicalises whatever comes back,
 * so the model's spelling doesn't have to be perfectly stable either.
 *
 * @param {string[]} existingTitles
 */
export function roleLabelSystemPrompt(existingTitles = []) {
  const existing = existingTitles.length
    ? `\nThe candidate has already practised for these roles:\n${existingTitles
        .map((t) => `- ${t}`)
        .join("\n")}\nIf a posting is the same kind of job as one of these, return that title EXACTLY as written above, rather than a new variation.\n`
    : "";

  return `You name the role a job posting is for, so a candidate's practice interviews can be grouped by role.

You will receive one or more job postings, each numbered.
${existing}
Return ONLY valid JSON (no markdown, no code fences) with exactly this shape:
{
  "roles": [{ "n": <posting number>, "title": "<role title>" }]
}

Rules for "title":
- A plain, widely used job title of 1-4 words in Title Case, e.g. "Frontend Engineer", "Data Analyst", "Product Manager".
- Leave out seniority (senior, junior, lead, staff, principal, intern, II), the company, the team or product area, the location, and employment type.
- Postings that are the same kind of job get the SAME title, both within this batch and with the existing roles above — "Front-End Developer" and "Frontend Engineer" are one role.
- Different jobs stay different: "Data Analyst" and "Data Scientist" are not the same role.
- Include exactly one entry per posting.`;
}

/**
 * The user message for a role-label batch. Only the head of each posting is
 * sent: the title and the opening responsibilities are what name a role, and
 * the tail is benefits boilerplate that just costs tokens.
 * @param {Array<{ n: number, jobDescription: string }>} items
 */
export function roleLabelUserMessage(items) {
  return `${items
    .map(
      (it) =>
        `--- POSTING ${it.n} ---\n${String(it.jobDescription || "").trim().slice(0, 1200)}`
    )
    .join("\n\n")}\n\nReturn the JSON.`;
}

/**
 * Progress — aggregates the evaluator's strengths and weaknesses across every
 * interview for one role into recurring themes. Strict JSON out.
 *
 * The model only says WHICH interviews each theme came from; the server
 * validates those numbers against the real list and does the counting itself,
 * so "Mentioned in 4 of 5 interviews" is never a figure the model made up.
 *
 * Scope is answer content. Speak-mode feedback can mention pace, pauses or
 * eye contact, and the Progress section deliberately leaves delivery out, so
 * those remarks are excluded here too.
 */
export function feedbackThemesSystemPrompt() {
  return `You analyse the written feedback from several mock interviews a candidate did for the same kind of role, and identify the themes that come up again and again.

You will receive the interviews numbered in date order (1 = oldest). Each lists the strengths and weaknesses an evaluator wrote for that interview.

Return ONLY valid JSON (no markdown, no code fences) with exactly this shape:
{
  "strengths": [{ "theme": "<short phrase>", "interviews": [<interview numbers>] }],
  "weaknesses": [{ "theme": "<short phrase>", "interviews": [<interview numbers>] }]
}

Rules:
- Merge bullets that make the same underlying point even when worded differently: "lacked concrete examples" and "answers stayed too general" are ONE theme.
- For each theme, list EVERY interview number whose feedback expresses it, and only those. Never add an interview whose feedback doesn't say it.
- Write each theme in your own words as a short, general observation (max 12 words), e.g. "Gives specific, measurable examples" or "Could explain trade-offs in more depth". Don't quote a single bullet verbatim.
- Put the themes that span the most interviews first. At most 6 per list.
- Ignore any remark about speaking pace, pauses, eye contact, looking at the camera, or other delivery — this summary covers the content of the answers only.
- Never invent feedback that isn't in the input. If a list has nothing, return [].`;
}

/**
 * The user message for a themes call: each interview's own strengths and
 * weaknesses, numbered oldest-first. Nothing else from the record is sent —
 * no answers, no job description, no delivery metrics.
 * @param {Array<{ strengths: string[], weaknesses: string[] }>} interviews
 */
export function feedbackThemesUserMessage(interviews) {
  const list = (items) =>
    items.length ? items.map((s) => `  - ${s}`).join("\n") : "  (none)";
  return `${interviews
    .map(
      (it, i) =>
        `INTERVIEW ${i + 1}\nStrengths:\n${list(it.strengths)}\nWeaknesses:\n${list(it.weaknesses)}`
    )
    .join("\n\n")}\n\nReturn the JSON.`;
}
