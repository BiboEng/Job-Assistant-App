import { config } from "../config.js";
import { chatCompletionJson } from "./openrouter.service.js";
import { listOwnerRecords, setInterviewRoles } from "./history.service.js";
import {
  cleanRoleTitle,
  effectiveRole,
  groupByRole,
  heuristicTitle,
  isLabelled,
  roleKey,
} from "./roleLabel.js";
import {
  roleLabelSystemPrompt,
  roleLabelUserMessage,
  feedbackThemesSystemPrompt,
  feedbackThemesUserMessage,
} from "../prompts/index.js";

/**
 * The Progress section: interview history grouped by role, and each role's
 * recurring feedback themes.
 *
 * Reads the existing history store and adds exactly one thing to it — a
 * `role: { title, source: "model" | "fallback", labelledAt }` label per interview. Themes
 * are never persisted: they're derived, cheap to recompute, and cached in
 * memory keyed by the exact set of interviews they summarise, so a new or
 * deleted interview invalidates them without any bookkeeping.
 *
 * Scope is scores and written feedback only: speak mode's delivery metrics
 * are never read, and nothing but the history store is.
 */

const MAX_THEMES_PER_SIDE = 6;
const MAX_THEME_LENGTH = 120;
const MAX_BULLETS_PER_SIDE = 8;
const MAX_BULLET_LENGTH = 240;

/* --- role labels ------------------------------------------------------------ */

// One labelling pass per owner at a time: the background label after a save
// and a GET /api/progress landing together must not both pay for the same
// interviews.
const labelling = new Map(); // ownerId → Promise
const labelFailedAt = new Map(); // ownerId → ms timestamp

/**
 * Names the role of every interview this owner has that the model hasn't
 * labelled yet, up to `maxLabelCallsPerRequest` batches. Never throws: a
 * failed call leaves those interviews on the first-line heuristic and backs
 * off for `labelRetryAfterMs`.
 * @param {string} ownerId
 * @returns {Promise<number>} interviews labelled
 */
export function ensureRoleLabels(ownerId) {
  if (!ownerId) return Promise.resolve(0);
  const running = labelling.get(ownerId);
  if (running) return running;

  const run = labelMissing(ownerId)
    .catch((err) => {
      console.warn("[progress] role labelling failed:", err?.message);
      labelFailedAt.set(ownerId, Date.now());
      return 0;
    })
    .finally(() => labelling.delete(ownerId));
  labelling.set(ownerId, run);
  return run;
}

async function labelMissing(ownerId) {
  const failedAt = labelFailedAt.get(ownerId);
  if (failedAt && Date.now() - failedAt < config.progress.labelRetryAfterMs) return 0;
  if (!config.openRouter.apiKey) return 0;

  const records = await listOwnerRecords(ownerId);
  // Newest first, so a user with a long unlabelled backlog sees their recent
  // practice grouped properly first.
  const missing = records
    .filter((r) => !isLabelled(r))
    .sort((a, b) => b.createdAt - a.createdAt);
  if (missing.length === 0) return 0;

  const { labelBatchSize, maxLabelCallsPerRequest } = config.progress;
  const batchSize = Math.max(1, labelBatchSize);
  let labelled = 0;

  for (let call = 0; call < maxLabelCallsPerRequest; call += 1) {
    const batch = missing.slice(call * batchSize, (call + 1) * batchSize);
    if (batch.length === 0) break;

    // Re-read the titles each round so batch two can reuse what batch one named.
    const existing = existingTitles(await listOwnerRecords(ownerId));
    const raw = await chatCompletionJson(
      [
        { role: "system", content: roleLabelSystemPrompt(existing) },
        {
          role: "user",
          content: roleLabelUserMessage(
            batch.map((r, i) => ({ n: i + 1, jobDescription: r.jobDescription }))
          ),
        },
      ],
      { kind: "progress" }
    );

    const titles = parseRoleLabels(raw, batch.length);
    const now = Date.now();
    const rolesById = new Map();
    batch.forEach((record, i) => {
      rolesById.set(
        record.id,
        titles[i]
          ? { title: titles[i], source: "model", labelledAt: now }
          : // The call worked but skipped this posting. Settle it on the
            // heuristic rather than paying to ask again on every visit.
            { title: heuristicTitle(record.jobDescription), source: "fallback", labelledAt: now }
      );
    });
    labelled += await setInterviewRoles(ownerId, rolesById);
  }

  labelFailedAt.delete(ownerId);
  return labelled;
}

/** Distinct model-given titles, most used first, bounded for the prompt. */
function existingTitles(records) {
  const counts = new Map();
  for (const r of records) {
    const role = effectiveRole(r);
    if (role.source !== "model") continue;
    counts.set(role.title, (counts.get(role.title) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([title]) => title);
}

/**
 * Maps a role-label response back onto the batch: returns an array of
 * `count` titles (null where the model gave nothing usable). Tolerates the
 * model dropping `n`, numbering from zero is NOT assumed, and a bare array.
 * @param {unknown} raw
 * @param {number} count
 * @returns {Array<string|null>}
 */
export function parseRoleLabels(raw, count) {
  const out = new Array(count).fill(null);
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.roles) ? raw.roles : [];

  list.forEach((item, i) => {
    const title = cleanRoleTitle(typeof item === "string" ? item : item?.title);
    if (!title) return;
    const n = Number.parseInt(item?.n ?? item?.number ?? item?.posting, 10);
    const idx = Number.isInteger(n) && n >= 1 && n <= count ? n - 1 : i;
    if (idx < count && out[idx] === null) out[idx] = title;
  });
  return out;
}

/* --- the overview ------------------------------------------------------------ */

/**
 * GET /api/progress: label what's missing (best effort), then group.
 *
 * Labelling a backlog can take a couple of sequential model calls, so the
 * request waits at most `labelWaitMs` for it. Past that it answers with the
 * first-line grouping and `labelling: true`; the labels keep landing in the
 * background and the client re-fetches shortly to pick them up.
 * @param {string} ownerId
 */
export async function getProgress(ownerId) {
  if (!ownerId) return { roles: [], labelling: false };

  let settled = false;
  const run = ensureRoleLabels(ownerId).finally(() => {
    settled = true;
  });
  let timer;
  await Promise.race([
    run,
    new Promise((resolve) => {
      timer = setTimeout(resolve, Math.max(0, config.progress.labelWaitMs));
    }),
  ]);
  clearTimeout(timer);

  const records = await listOwnerRecords(ownerId);
  return { roles: groupByRole(records), labelling: !settled };
}

/* --- recurring themes -------------------------------------------------------- */

const themeCache = new Map(); // cacheKey → result
const themeInFlight = new Map(); // cacheKey → Promise

function remember(key, value) {
  themeCache.delete(key);
  themeCache.set(key, value);
  while (themeCache.size > Math.max(1, config.progress.themeCacheMax)) {
    themeCache.delete(themeCache.keys().next().value);
  }
}

/**
 * Recurring strengths and weaknesses for one of an owner's roles.
 *
 * A role with a single interview makes no model call: there's nothing to find
 * recurrence across, so its own bullets come back as-is (flagged `single`).
 *
 * @param {string} ownerId
 * @param {string} key a role key from GET /api/progress
 * @returns {Promise<object|null>} null when the owner has no such role
 */
export async function getRoleThemes(ownerId, key) {
  if (!ownerId) return null;
  const records = await listOwnerRecords(ownerId);
  const inRole = records.filter((r) => roleKey(effectiveRole(r).title) === key);
  if (inRole.length === 0) return null;

  // Oldest first, capped to the most recent N — the order "1 = oldest" in the
  // prompt refers to.
  const analysed = inRole.slice(-Math.max(1, config.progress.maxThemeInterviews));
  const ids = analysed.map((r) => r.id);
  const feedback = analysed.map((r) => ({
    strengths: bullets(r.feedback?.strengths),
    weaknesses: bullets(r.feedback?.weaknesses),
  }));

  const base = {
    roleKey: key,
    interviewCount: analysed.length,
    totalCount: inRole.length,
    interviewIds: ids,
  };

  if (analysed.length === 1) {
    const only = (list) =>
      list.slice(0, MAX_THEMES_PER_SIDE).map((theme) => ({
        theme: theme.slice(0, MAX_THEME_LENGTH),
        interviewIds: [ids[0]],
        count: 1,
      }));
    return {
      ...base,
      single: true,
      strengths: only(feedback[0].strengths),
      weaknesses: only(feedback[0].weaknesses),
    };
  }

  const cacheKey = `${ownerId}\u0000${key}\u0000${ids.join(",")}`;
  if (themeCache.has(cacheKey)) return themeCache.get(cacheKey);
  if (themeInFlight.has(cacheKey)) return themeInFlight.get(cacheKey);

  const run = (async () => {
    const raw = await chatCompletionJson(
      [
        { role: "system", content: feedbackThemesSystemPrompt() },
        { role: "user", content: feedbackThemesUserMessage(feedback) },
      ],
      { kind: "progress" }
    );
    const result = { ...base, single: false, ...normalizeThemes(raw, ids) };
    remember(cacheKey, result);
    return result;
  })().finally(() => themeInFlight.delete(cacheKey));

  themeInFlight.set(cacheKey, run);
  return run;
}

function bullets(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((s) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim() : ""))
    .filter(Boolean)
    .slice(0, MAX_BULLETS_PER_SIDE)
    .map((s) => s.slice(0, MAX_BULLET_LENGTH));
}

/**
 * Validates a themes response against the interviews it was asked about.
 *
 * The model names interviews by their 1-based position in `interviewIds`.
 * Every number is checked against that list and de-duplicated, and the count
 * is computed here — so "Mentioned in 4 of 5 interviews" is a fact about the
 * input, never a number the model asserted. A theme left with no valid
 * interview is dropped; two themes the model wrote identically are merged.
 * Sorted by how many interviews mention them (stable, so the model's own
 * ordering breaks ties), capped per side.
 *
 * @param {unknown} raw
 * @param {string[]} interviewIds oldest first
 * @returns {{ strengths: Theme[], weaknesses: Theme[] }}
 *   where Theme = { theme: string, interviewIds: string[], count: number }
 */
export function normalizeThemes(raw, interviewIds) {
  const side = (list) => {
    if (!Array.isArray(list)) return [];
    const merged = new Map(); // lowercased theme → { theme, idx:Set }

    for (const item of list) {
      const text = typeof item === "string" ? item : item?.theme;
      const theme = cleanThemeText(text);
      if (!theme) continue;

      const refs = item?.interviews ?? item?.interviewNumbers ?? item?.mentions ?? [];
      const idx = new Set();
      for (const ref of Array.isArray(refs) ? refs : [refs]) {
        const n = Number.parseInt(String(ref).replace(/[^\d-]/g, ""), 10);
        if (Number.isInteger(n) && n >= 1 && n <= interviewIds.length) idx.add(n - 1);
      }
      if (idx.size === 0) continue;

      const k = theme.toLowerCase();
      const entry = merged.get(k) ?? { theme, idx: new Set() };
      for (const i of idx) entry.idx.add(i);
      merged.set(k, entry);
    }

    return [...merged.values()]
      .map(({ theme, idx }) => {
        const order = [...idx].sort((a, b) => a - b);
        return { theme, interviewIds: order.map((i) => interviewIds[i]), count: order.length };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, MAX_THEMES_PER_SIDE);
  };

  return { strengths: side(raw?.strengths), weaknesses: side(raw?.weaknesses) };
}

function cleanThemeText(raw) {
  if (typeof raw !== "string") return null;
  const s = raw
    .replace(/\s+/g, " ")
    .replace(/^[-•*\s"']+|["'\s]+$/g, "")
    .trim()
    .slice(0, MAX_THEME_LENGTH)
    .trim();
  return s || null;
}

/** Test hook: forget cached themes and label back-off state. */
export function _resetProgressState() {
  themeCache.clear();
  themeInFlight.clear();
  labelling.clear();
  labelFailedAt.clear();
}
