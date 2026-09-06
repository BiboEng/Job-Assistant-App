import { Router } from "express";
import { config } from "../config.js";
import {
  startInterview,
  submitAnswer,
  generateFeedback,
  getSessionState,
} from "../controllers/interview.controller.js";

export const interviewRouter = Router();

interviewRouter.post("/start", startInterview);
interviewRouter.post("/:sessionId/answer", submitAnswer);
interviewRouter.post("/:sessionId/feedback", generateFeedback);

// Read-only session inspection. Debugging aid only — off unless
// ENABLE_DEBUG_ROUTES=true.
if (config.enableDebugRoutes) {
  interviewRouter.get("/:sessionId", getSessionState);
}
