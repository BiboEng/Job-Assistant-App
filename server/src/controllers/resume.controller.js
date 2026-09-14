import { config } from "../config.js";
import { chatCompletionJson } from "../services/openrouter.service.js";
import {
  resumeBuilderSystemPrompt,
  resumeTurnMessage,
} from "../prompts/index.js";
import {
  normalizeResume,
  validateChatHistory,
  interpretModelTurn,
} from "../services/resume.service.js";

/**
 * Resume Builder chat — one stateless turn.
 *
 *   POST /api/resume/chat  { messages: [{ role, content }], resume }
 *     -> { reply, resume, changed }
 *
 * Stateless by design (like Job Matches): the client owns the conversation and
 * the live document, and re-sends both. That is what keeps the model and the
 * user's manual edits in sync — the resume posted here is the state the user is
 * actually looking at, so the model can never answer from a stale copy it
 * remembered from earlier in the conversation.
 *
 * Runs in the separate "resume" model-budget pool.
 */
export async function chatResume(req, res, next) {
  try {
    const { messages, resume } = req.body ?? {};

    const history = validateChatHistory(messages);
    if (history.error) {
      return res.status(400).json({ error: history.error });
    }

    // Guard the raw payload before normalizing: a huge blob costs tokens even if
    // normalization would trim it back down.
    if (resume != null) {
      let serialized;
      try {
        serialized = JSON.stringify(resume);
      } catch {
        return res.status(400).json({ error: "That resume could not be read." });
      }
      if (serialized.length > config.resume.maxResumeJsonLength) {
        return res.status(400).json({
          error: "That resume is too long. Trim a section and try again.",
        });
      }
    }

    const current = normalizeResume(resume);

    // Prior turns go through verbatim; the newest user message is folded into
    // one final message alongside the live document.
    const prior = history.messages.slice(0, -1);
    const latest = history.messages[history.messages.length - 1].content;

    let raw;
    try {
      raw = await chatCompletionJson(
        [
          { role: "system", content: resumeBuilderSystemPrompt() },
          ...prior,
          { role: "user", content: resumeTurnMessage(current, latest) },
        ],
        { kind: "resume" }
      );
    } catch (err) {
      console.error("[resume] chat turn failed:", err.message);
      return next(err); // openrouter.service marks its errors expose-safe
    }

    const turn = interpretModelTurn(raw);

    // A null document means "nothing changed" — keep the resume exactly as the
    // client sent it rather than round-tripping it through the model's copy.
    const changed = turn.resume != null;
    const resumeOut = changed ? normalizeResume(turn.resume) : current;

    const reply =
      turn.reply.slice(0, config.resume.maxMessageLength) ||
      (changed
        ? "Updated your resume — take a look on the right."
        : "Got it. What would you like to change?");

    return res.status(200).json({ reply, resume: resumeOut, changed });
  } catch (err) {
    next(err);
  }
}
