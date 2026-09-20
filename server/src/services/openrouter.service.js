import { config } from "../config.js";
import { withModelBudget } from "./modelBudget.js";

/**
 * The single place that talks to OpenRouter. Never import this into the client.
 *
 * All errors thrown here carry a user-safe `.message` and `.expose = true` so the
 * central error handler can surface them without leaking upstream detail.
 *
 * @param {Array<{role: string, content: string}>} messages
 * @param {{ json?: boolean, temperature?: number }} [options]
 * @returns {Promise<string>} the assistant message content
 */
export async function chatCompletion(messages, options = {}) {
  if (!config.openRouter.apiKey) {
    throw expose(new Error("The server is missing its AI API key."), 500);
  }

  return withModelBudget(() => callOpenRouter(messages, options), {
    kind: options.kind,
  });
}

async function callOpenRouter(messages, options) {
  const body = {
    model: config.model,
    messages,
    temperature: options.temperature ?? 0.7,
  };

  if (options.json) {
    body.response_format = { type: "json_object" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.openRouter.timeoutMs);

  let res;
  try {
    res = await fetch(config.openRouter.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.openRouter.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": config.openRouter.referer,
        "X-Title": config.openRouter.title,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (cause) {
    if (cause?.name === "AbortError") {
      throw expose(new Error("The AI service took too long to respond. Please try again."), 504, cause);
    }
    throw expose(new Error("Could not reach the AI service. Please try again."), 502, cause);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("[openrouter]", res.status, detail.slice(0, 500));
    if (res.status === 429) {
      throw expose(
        new Error("The AI service is busy right now. Wait a few seconds and try again."),
        429
      );
    }
    const err = expose(new Error("The AI service returned an error. Please try again."), 502);
    // Some models reject response_format. Flag it so the JSON caller can retry
    // in plain mode and lean on the prompt + tolerant parser instead.
    if (res.status === 400 && /structured|response_format|json_schema|json mode/i.test(detail)) {
      err.unsupportedJsonMode = true;
    }
    throw err;
  }

  const data = await res.json().catch(() => null);
  const content = data?.choices?.[0]?.message?.content;

  if (!content || typeof content !== "string") {
    throw expose(new Error("The AI service returned an empty response. Please try again."), 502);
  }

  return content.trim();
}

/**
 * Calls the model expecting JSON back, with a tolerant parser (strips accidental
 * code fences / prose around the object).
 *
 * Retries are deliberately narrow: we retry once when the model returns
 * unparseable text, and switch to plain (non-JSON-mode) completion once if the
 * model rejects `response_format`. We do NOT retry transport errors, timeouts,
 * 5xx, or 429 — those already failed slowly and expensively; re-running them
 * just multiplies the cost and pushes past the client's timeout.
 *
 * The first time the configured model rejects JSON mode we remember it
 * process-wide, so later calls (e.g. scoring many jobs in one Job Matches batch)
 * skip straight to plain mode instead of burning a failed request each. The flag
 * expires after JSON_MODE_RETRY_AFTER_MS so a one-off misclassified 400 doesn't
 * disable JSON mode for the whole process lifetime.
 */
const JSON_MODE_RETRY_AFTER_MS = 30 * 60 * 1000;
let jsonModeRejectedAt = 0;

function jsonModeCurrentlyRejected() {
  return (
    jsonModeRejectedAt > 0 &&
    Date.now() - jsonModeRejectedAt < JSON_MODE_RETRY_AFTER_MS
  );
}

/**
 * What the caller was asking the model for, used only to word the "unparseable
 * response" error. "feedback" is interview wording and used to leak into the
 * Resume Builder and Job Matches, where it makes no sense.
 */
const SUBJECT_BY_KIND = {
  interview: "feedback",
  jobs: "a usable match score",
  resume: "a usable answer",
};

export async function chatCompletionJson(messages, options = {}) {
  let useJsonMode = !jsonModeCurrentlyRejected();
  let lastParseErr;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let raw;
    try {
      raw = await chatCompletion(messages, {
        json: useJsonMode,
        temperature: 0.3,
        kind: options.kind,
      });
    } catch (err) {
      if (err?.unsupportedJsonMode && useJsonMode) {
        jsonModeRejectedAt = Date.now(); // remember for later calls (time-boxed)
        useJsonMode = false; // immediate retry, plain mode
        continue;
      }
      throw err; // network / timeout / 5xx / 429 — surface as-is, don't hammer
    }

    try {
      return parseJsonLoose(raw);
    } catch (err) {
      lastParseErr = err;
      // loop once more for a cleaner response
    }
  }

  const subject = SUBJECT_BY_KIND[options.kind] || "a usable answer";
  console.error(
    `[openrouter] JSON response unparseable (${options.kind || "interview"}):`,
    lastParseErr?.message
  );
  throw expose(
    new Error(`The AI service did not return ${subject}. Please try again.`),
    502,
    lastParseErr
  );
}

export function parseJsonLoose(raw) {
  let text = String(raw).trim();

  if (text.startsWith("```")) {
    text = text
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();
  }

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace <= firstBrace) {
    throw new Error("No JSON object found in model response.");
  }
  if (firstBrace > 0 || lastBrace < text.length - 1) {
    text = text.slice(firstBrace, lastBrace + 1);
  }
  return JSON.parse(text);
}

function expose(err, status, cause) {
  err.status = status;
  err.expose = true;
  if (cause) err.cause = cause;
  return err;
}
