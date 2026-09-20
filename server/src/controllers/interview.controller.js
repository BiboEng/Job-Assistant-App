import { config } from "../config.js";
import {
  chatCompletion,
  chatCompletionJson,
} from "../services/openrouter.service.js";
import {
  createSession,
  getSession,
  beginProcessing,
  endProcessing,
  recordQuestion,
  recordAnswer,
  markCompleted,
  saveFeedback,
  publicSession,
} from "../services/session.service.js";
import {
  evaluatorSystemPrompt,
  transcriptForEvaluator,
} from "../prompts/index.js";
import { estimateAnswerSeconds } from "../timeLimit.js";
import { assertOwner } from "../middleware/auth.js";

/**
 * POST /api/interview/start
 * body: { jobDescription, questionCount?, focus?, resumeText?, mode? }
 */
export async function startInterview(req, res, next) {
  try {
    const { jobDescription, questionCount, focus, resumeText, mode } =
      req.body ?? {};

    if (typeof jobDescription !== "string") {
      return res.status(400).json({ error: "jobDescription is required." });
    }
    const jd = jobDescription.trim();
    if (jd.length < config.minJobDescriptionLength) {
      return res.status(400).json({
        error: `jobDescription must be at least ${config.minJobDescriptionLength} characters.`,
      });
    }
    if (jd.length > config.maxJobDescriptionLength) {
      return res.status(400).json({
        error: `jobDescription must be at most ${config.maxJobDescriptionLength} characters.`,
      });
    }

    if (focus != null && !config.interviewFocuses.includes(focus)) {
      return res.status(400).json({ error: "Unknown interview focus." });
    }
    if (mode != null && !config.interviewModes.includes(mode)) {
      return res.status(400).json({ error: "Unknown interview mode." });
    }
    let resume = "";
    if (resumeText != null) {
      if (typeof resumeText !== "string") {
        return res.status(400).json({ error: "resumeText must be text." });
      }
      resume = resumeText.trim().slice(0, config.maxInterviewResumeLength);
    }

    const session = createSession(jd, req.clientId, {
      totalQuestions: questionCount,
      focus,
      resumeText: resume,
      mode,
    });

    const question = await chatCompletion(session.messages);
    const timeLimitSeconds = estimateAnswerSeconds(question);
    recordQuestion(session, question, timeLimitSeconds);

    return res.status(201).json({
      sessionId: session.id,
      question,
      questionNumber: session.askedCount,
      totalQuestions: session.totalQuestions,
      // Echoed back so the client drives the chat screen off what the server
      // actually accepted, not off what it asked for.
      mode: session.mode,
      timeLimitSeconds,
      done: false,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/interview/:sessionId/answer
 * body: { answer, timedOut?, delivery? }
 */
export async function submitAnswer(req, res, next) {
  let session;
  try {
    session = getSession(req.params.sessionId);
    if (!session) return res.status(404).json({ error: "Session not found or expired." });
    assertOwner(session, req);

    if (session.status === "completed") {
      return res.status(409).json({ error: "This interview has already ended." });
    }

    const { answer, timedOut, delivery } = req.body ?? {};
    if (typeof answer !== "string") {
      return res.status(400).json({ error: "answer is required." });
    }
    // A normal submit needs content; a timed-out submit may be empty (the
    // question is then treated as skipped, like ending the interview early).
    if (answer.trim().length === 0 && !timedOut) {
      return res.status(400).json({ error: "answer is required." });
    }
    if (answer.length > config.maxAnswerLength) {
      return res.status(400).json({
        error: `answer must be at most ${config.maxAnswerLength} characters.`,
      });
    }

    if (!beginProcessing(session)) {
      return res
        .status(409)
        .json({ error: "Still processing your previous answer. Please wait." });
    }

    try {
      recordAnswer(session, answer.trim(), normalizeDelivery(delivery, session));

      // Was that the final answer?
      if (session.askedCount >= session.totalQuestions) {
        markCompleted(session);
        return res.status(200).json({
          question: null,
          questionNumber: session.askedCount,
          totalQuestions: session.totalQuestions,
          done: true,
        });
      }

      const question = await chatCompletion(session.messages);
      const timeLimitSeconds = estimateAnswerSeconds(question);
      recordQuestion(session, question, timeLimitSeconds);

      return res.status(200).json({
        question,
        questionNumber: session.askedCount,
        totalQuestions: session.totalQuestions,
        timeLimitSeconds,
        done: false,
      });
    } finally {
      endProcessing(session);
    }
  } catch (err) {
    if (session) endProcessing(session);
    next(err);
  }
}

/**
 * POST /api/interview/:sessionId/feedback
 * Generates (once) and returns final scoring. Works after the last answer or
 * when the user ends the interview early.
 */
export async function generateFeedback(req, res, next) {
  let session;
  try {
    session = getSession(req.params.sessionId);
    if (!session) return res.status(404).json({ error: "Session not found or expired." });
    assertOwner(session, req);

    if (session.feedback) {
      return res.status(200).json(session.feedback);
    }

    // Evaluate every question that was actually asked — skipped ones included,
    // so the report reflects the whole interview instead of silently dropping
    // unanswered questions.
    const askedPairs = session.qaPairs.filter((p) => p.question);
    const answeredCount = askedPairs.filter((p) => p.answer && p.answer.trim()).length;
    if (answeredCount === 0) {
      return res.status(400).json({ error: "No answers to evaluate yet." });
    }

    if (!beginProcessing(session)) {
      return res
        .status(409)
        .json({ error: "Feedback is already being generated. Please wait." });
    }

    try {
      // Re-check now that we hold the lock (a concurrent request may have won).
      if (session.feedback) return res.status(200).json(session.feedback);

      // End the interview if the user bailed early.
      if (session.status !== "completed") markCompleted(session);

      const messages = [
        {
          role: "system",
          content: evaluatorSystemPrompt(session.jobDescription, {
            mode: session.mode,
          }),
        },
        {
          role: "user",
          content:
            "Here is the interview transcript. Evaluate it and return the JSON.\n\n" +
            transcriptForEvaluator(askedPairs),
        },
      ];

      // `kind` is the interview pool's default anyway; passing it explicitly is
      // what words the "unparseable response" error as being about feedback.
      const feedback = await chatCompletionJson(messages, { kind: "interview" });
      const normalized = normalizeFeedback(feedback, askedPairs);

      saveFeedback(session, normalized);
      return res.status(200).json(normalized);
    } finally {
      endProcessing(session);
    }
  } catch (err) {
    if (session) endProcessing(session);
    next(err);
  }
}

/**
 * GET /api/interview/:sessionId  (debug / page refresh)
 */
export function getSessionState(req, res) {
  const session = getSession(req.params.sessionId, { touch: false });
  if (!session) return res.status(404).json({ error: "Session not found or expired." });
  assertOwner(session, req);
  return res.status(200).json(publicSession(session));
}

// --- helpers -------------------------------------------------------------

/** Round and clamp to a range, or null if it isn't a usable number. */
function clampOrNull(n, min, max) {
  if (n == null) return null;
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return null;
  return Math.min(max, Math.max(min, v));
}

/**
 * Speak-mode delivery metrics, rebuilt from scratch out of a numeric allowlist.
 *
 * Everything here is measured in the candidate's browser, so none of it is
 * trusted: unknown keys are dropped, each value is coerced to an integer and
 * clamped, and a metric the browser couldn't estimate stays null rather than
 * becoming a zero the evaluator would read as "they never paused". Returns null
 * for a type-mode session, so no amount of client-side insistence can attach
 * delivery data to an interview that wasn't spoken.
 *
 * @param {unknown} raw
 * @param {{ mode?: string }} session
 * @returns {{ wpm: number|null, pauseCount: number|null, pauseMs: number|null,
 *   speakingMs: number|null, onCameraPct: number|null } | null}
 */
export function normalizeDelivery(raw, session) {
  if (session?.mode !== "speak") return null;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;

  const d = config.delivery;
  const wpm = clampOrNull(raw.wpm, d.minWpm, d.maxWpm);
  const pauseCount = clampOrNull(raw.pauseCount, 0, d.maxPauseCount);
  const pauseMs = clampOrNull(raw.pauseMs, 0, d.maxPauseMs);
  const speakingMs = clampOrNull(raw.speakingMs, 0, d.maxSpeakingMs);
  const onCameraPct = clampOrNull(raw.onCameraPct, 0, 100);

  // Nothing measurable came through — store null rather than an object of nulls.
  if (
    wpm == null &&
    pauseCount == null &&
    pauseMs == null &&
    speakingMs == null &&
    onCameraPct == null
  ) {
    return null;
  }

  // A pause total without a count is meaningless on its own, and vice versa.
  const hasPauses = pauseCount != null;
  return {
    wpm,
    pauseCount,
    pauseMs: hasPauses ? pauseMs ?? 0 : null,
    speakingMs,
    onCameraPct,
  };
}

function toText(v) {
  if (typeof v === "string") return v;
  if (v == null) return "";
  if (typeof v === "object") {
    return String(v.text ?? v.point ?? v.value ?? JSON.stringify(v));
  }
  return String(v);
}

export function normalizeFeedback(raw, qaPairs) {
  const clampInt = (n, min, max, fallback) => {
    const v = Math.round(Number(n));
    return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
  };

  const perQuestion = Array.isArray(raw?.perQuestion) ? raw.perQuestion : [];
  const usedIdx = new Set();

  return {
    overallScore: clampInt(raw?.overallScore, 0, 100, 0),
    summary: typeof raw?.summary === "string" ? raw.summary : "",
    strengths: Array.isArray(raw?.strengths)
      ? raw.strengths.map(toText).filter(Boolean)
      : [],
    weaknesses: Array.isArray(raw?.weaknesses)
      ? raw.weaknesses.map(toText).filter(Boolean)
      : [],
    perQuestion: qaPairs.map((p, i) => {
      // Prefer an explicit questionNumber match; fall back to positional only if
      // that slot hasn't already been claimed by another question.
      let matchIdx = perQuestion.findIndex(
        (q) => Number(q?.questionNumber) === p.questionNumber
      );
      if (matchIdx === -1 && !usedIdx.has(i) && perQuestion[i]) matchIdx = i;
      const match = matchIdx >= 0 ? perQuestion[matchIdx] : {};
      if (matchIdx >= 0) usedIdx.add(matchIdx);

      const skipped = !(p.answer && p.answer.trim());
      return {
        questionNumber: p.questionNumber,
        question: p.question,
        answer: p.answer || "",
        timeLimitSeconds: p.timeLimitSeconds ?? null,
        score: skipped ? 0 : clampInt(match?.score, 0, 10, 0),
        comment:
          typeof match?.comment === "string"
            ? match.comment
            : toText(match?.comment) ||
              (skipped ? "No answer was given for this question." : ""),
      };
    }),
  };
}
