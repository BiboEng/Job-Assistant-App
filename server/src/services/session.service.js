import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { interviewerSystemPrompt } from "../prompts/index.js";

/**
 * In-memory session store. Map<sessionId, session>.
 * Lost on server restart — swap this module for a DB-backed one later.
 */
const sessions = new Map();

/**
 * @typedef {Object} Session
 * @property {string} id
 * @property {string|null} ownerId  client id that created it (history scoping)
 * @property {string} jobDescription
 * @property {number} createdAt
 * @property {number} updatedAt
 * @property {"active" | "completed"} status
 * @property {boolean} processing  true while a model call for this session is in flight
 * @property {number} totalQuestions
 * @property {number} askedCount
 * @property {Array<{role: string, content: string}>} messages  full chat history for the model
 * @property {Array<{questionNumber: number, question: string, answer: string|null, timeLimitSeconds: number|null}>} qaPairs
 * @property {object|null} feedback  cached after first generation
 * @property {string|null} savedInterviewId  history record id once persisted
 */

/** Clamp a requested question count to the configured range (default on junk). */
export function clampQuestions(n) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return config.totalQuestions;
  return Math.min(config.maxQuestions, Math.max(config.minQuestions, v));
}

function pruneExpired() {
  const cutoff = Date.now() - config.sessionTtlMs;
  for (const [id, session] of sessions) {
    if (session.updatedAt < cutoff) sessions.delete(id);
  }
}

/**
 * @param {string} jobDescription
 * @param {string|null} [ownerId]
 * @param {{ totalQuestions?: number, focus?: string, resumeText?: string }} [opts]
 * @throws a user-safe 503 when the live-session cap is reached.
 */
export function createSession(jobDescription, ownerId = null, opts = {}) {
  if (sessions.size >= config.limits.maxLiveSessions) {
    pruneExpired();
  }
  if (sessions.size >= config.limits.maxLiveSessions) {
    const err = new Error("The interview service is at capacity. Please try again shortly.");
    err.status = 503;
    err.expose = true;
    throw err;
  }

  const now = Date.now();
  const id = randomUUID();

  const totalQuestions = clampQuestions(opts.totalQuestions);
  const focus = config.interviewFocuses.includes(opts.focus)
    ? opts.focus
    : "mixed";

  /** @type {Session} */
  const session = {
    id,
    ownerId,
    jobDescription,
    focus,
    createdAt: now,
    updatedAt: now,
    status: "active",
    processing: false,
    totalQuestions,
    askedCount: 0,
    messages: [
      {
        role: "system",
        content: interviewerSystemPrompt(jobDescription, {
          totalQuestions,
          focus,
          resumeText: opts.resumeText,
        }),
      },
    ],
    qaPairs: [],
    feedback: null,
    savedInterviewId: null,
  };

  sessions.set(id, session);
  return session;
}

/**
 * @param {string} id
 * @param {{ touch?: boolean }} [opts]  touch (default true) bumps the TTL clock;
 *   pass { touch: false } for read-only/debug reads so polling can't keep a
 *   session alive forever.
 */
export function getSession(id, { touch = true } = {}) {
  const session = sessions.get(id);
  if (session && touch) session.updatedAt = Date.now();
  return session || null;
}

/**
 * Claim the session for a model call. Returns false if one is already running,
 * which lets controllers reject concurrent/duplicate requests with a 409 instead
 * of corrupting the transcript or paying for a redundant call.
 */
export function beginProcessing(session) {
  if (session.processing) return false;
  session.processing = true;
  return true;
}

export function endProcessing(session) {
  session.processing = false;
}

/**
 * Record a question the interviewer just asked.
 */
export function recordQuestion(session, questionText, timeLimitSeconds = null) {
  session.askedCount += 1;
  session.messages.push({ role: "assistant", content: questionText });
  session.qaPairs.push({
    questionNumber: session.askedCount,
    question: questionText,
    answer: null,
    timeLimitSeconds,
  });
  session.updatedAt = Date.now();
}

/**
 * Record the candidate's answer to the most recent question.
 */
export function recordAnswer(session, answerText) {
  // Keep the model turn coherent even when the candidate ran out of time, but
  // store the raw answer ("" when skipped) so feedback can exclude it.
  const forModel =
    answerText.trim() || "(No answer — the candidate ran out of time.)";
  session.messages.push({ role: "user", content: forModel });
  const current = session.qaPairs[session.qaPairs.length - 1];
  if (current) current.answer = answerText;
  session.updatedAt = Date.now();
}

export function markCompleted(session) {
  session.status = "completed";
  session.updatedAt = Date.now();
}

export function saveFeedback(session, feedback) {
  session.feedback = feedback;
  session.updatedAt = Date.now();
}

/** Public-safe view of a session (no raw model message array by default). */
export function publicSession(session) {
  return {
    sessionId: session.id,
    status: session.status,
    jobDescription: session.jobDescription,
    totalQuestions: session.totalQuestions,
    askedCount: session.askedCount,
    transcript: session.qaPairs,
    hasFeedback: Boolean(session.feedback),
  };
}

export function sessionCount() {
  return sessions.size;
}

// --- TTL cleanup -----------------------------------------------------------
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;

const timer = setInterval(pruneExpired, CLEANUP_INTERVAL_MS);
timer.unref?.();
