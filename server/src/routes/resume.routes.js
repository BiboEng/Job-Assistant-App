import { Router } from "express";
import { chatResume } from "../controllers/resume.controller.js";

export const resumeRouter = Router();

resumeRouter.post("/chat", chatResume);
