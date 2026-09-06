import { config } from "./config.js";

/**
 * Estimate how long a candidate reasonably needs to type a good answer to a
 * question, clamped to config.answerSeconds (1–5 min) and rounded to 15s.
 *
 * Heuristic, not model-driven: longer and more open-ended / multi-part prompts
 * get more time; quick factual prompts get less.
 */
export function estimateAnswerSeconds(question) {
  const q = String(question || "");
  const words = q.trim().split(/\s+/).filter(Boolean).length;

  let score = words; // ~8–45 for a typical interview question

  // Multi-part / compound prompts ask for more.
  if ((q.match(/\?/g)?.length ?? 0) > 1) score += 15;
  score += (q.match(/[,;]|\band\b/gi)?.length ?? 0) * 2;

  // Depth signals -> expect a longer, structured answer.
  if (/\b(walk me through|step[- ]by[- ]step|in detail|deep dive|architect|design)\b/i.test(q))
    score += 25;
  if (/\b(tell me about a time|describe a situation|give an example|share an experience|how did you)\b/i.test(q))
    score += 20;
  if (/\b(trade[- ]?offs?|compare|why|how would you|what.s your approach)\b/i.test(q))
    score += 12;

  // Quick-hit signals -> short answer.
  if (/\b(what is|which|do you|have you|how many|how long|yes or no|rate your)\b/i.test(q))
    score -= 12;

  const { min, max } = config.answerSeconds;
  const clampedScore = Math.max(0, Math.min(120, score));
  const raw = min + (clampedScore / 120) * (max - min);
  const rounded = Math.round(raw / 15) * 15;
  return Math.max(min, Math.min(max, rounded));
}
