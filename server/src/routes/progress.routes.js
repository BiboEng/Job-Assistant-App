import { Router } from "express";
import {
  getProgressOverview,
  getProgressThemes,
} from "../controllers/progress.controller.js";

export const progressRouter = Router();

progressRouter.get("/", getProgressOverview);
progressRouter.post("/themes", getProgressThemes);
