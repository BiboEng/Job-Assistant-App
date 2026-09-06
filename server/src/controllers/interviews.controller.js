import {
  listInterviews,
  getInterview,
  saveInterview,
  deleteInterview,
} from "../services/history.service.js";
import { getSession } from "../services/session.service.js";
import { assertOwner } from "../middleware/auth.js";

/**
 * GET /api/interviews
 * Lightweight list for the home screen (newest first), scoped to the caller.
 */
export async function getInterviewsList(req, res, next) {
  try {
    res.status(200).json(await listInterviews(req.clientId));
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/interviews/:id
 * Full stored record (job description, Q&A, feedback) — owner only.
 */
export async function getInterviewDetail(req, res, next) {
  try {
    const record = await getInterview(req.params.id, req.clientId);
    if (!record) return res.status(404).json({ error: "Interview not found." });
    res.status(200).json(record);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/interviews   body: { sessionId }
 * Persists a completed session to history. Idempotent per session: re-posting a
 * session that's already saved returns the existing record.
 */
export async function createInterview(req, res, next) {
  try {
    if (!req.clientId) {
      return res.status(400).json({ error: "A client id is required to save history." });
    }

    const { sessionId } = req.body ?? {};
    if (typeof sessionId !== "string" || !sessionId) {
      return res.status(400).json({ error: "sessionId is required." });
    }

    const session = getSession(sessionId, { touch: false });
    if (!session) {
      return res.status(404).json({ error: "Session not found or expired." });
    }
    assertOwner(session, req);
    if (!session.feedback) {
      return res.status(400).json({ error: "This interview has no feedback yet." });
    }

    if (session.savedInterviewId) {
      const existing = await getInterview(session.savedInterviewId, req.clientId);
      if (existing) return res.status(200).json(existing);
    }

    const record = await saveInterview({
      ownerId: req.clientId,
      jobDescription: session.jobDescription,
      qaPairs: session.qaPairs,
      totalQuestions: session.totalQuestions,
      feedback: session.feedback,
    });
    session.savedInterviewId = record.id;

    res.status(201).json(record);
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/interviews/:id  — owner only.
 */
export async function removeInterview(req, res, next) {
  try {
    const removed = await deleteInterview(req.params.id, req.clientId);
    if (!removed) return res.status(404).json({ error: "Interview not found." });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}
