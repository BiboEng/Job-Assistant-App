import { Router } from "express";
import { searchJobs, scoreJobs } from "../controllers/jobs.controller.js";

export const jobsRouter = Router();

jobsRouter.post("/search", searchJobs);
jobsRouter.post("/score", scoreJobs);
