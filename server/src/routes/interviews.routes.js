import { Router } from "express";
import {
  getInterviewsList,
  getInterviewDetail,
  createInterview,
  removeInterview,
} from "../controllers/interviews.controller.js";

export const interviewsRouter = Router();

interviewsRouter.get("/", getInterviewsList);
interviewsRouter.get("/:id", getInterviewDetail);
interviewsRouter.post("/", createInterview);
interviewsRouter.delete("/:id", removeInterview);
