import { config } from "../config.js";

/**
 * The resume document model — the single shape shared by the chat endpoint, the
 * client preview, and every exporter.
 *
 * Deliberately single-column and plain: contact / summary / experience /
 * education / skills / projects / certifications. Applicant tracking systems
 * parse that layout reliably; multi-column or table-based resumes do not.
 *
 * `normalizeResume` is the only way a resume object enters the system. It runs
 * over BOTH directions of untrusted input:
 *   - the current resume posted by the client (which the user may have hand
 *     edited), and
 *   - whatever the model returns.
 * So every field is coerced, trimmed, length-capped and count-capped here, and
 * callers can treat the result as a known-good document.
 *
 * Keep the caps in sync with RESUME_LIMITS in client/src/constants.js
 * (server/test/resumeSync.test.js is not possible across packages, so the
 * client mirrors these values and resumeModel.test.js guards the server half).
 */

export const RESUME_LIMITS = {
  short: 120, // names, titles, companies, dates
  line: 200, // location, links, degree
  bullet: 400,
  summary: 1_500,
  details: 600,
  maxLinks: 6,
  maxExperience: 12,
  maxEducation: 8,
  maxSkillGroups: 8,
  maxSkillItems: 30,
  maxProjects: 8,
  maxCertifications: 10,
  maxBullets: 12,
};

/** A blank document — every section present, nothing filled in. */
export function emptyResume() {
  return {
    contact: { name: "", title: "", email: "", phone: "", location: "", links: [] },
    summary: "",
    experience: [],
    education: [],
    skills: [],
    projects: [],
    certifications: [],
  };
}

let idCounter = 0;
/** Stable-enough id for list keys. Ids round-trip so React keys stay put. */
export function resumeId(prefix = "e") {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

// --- primitives ----------------------------------------------------------

/** Coerce to a trimmed single-line string, capped. Non-strings become "". */
function str(v, max) {
  if (typeof v === "number" && Number.isFinite(v)) v = String(v);
  if (typeof v !== "string") return "";
  // Collapse all whitespace: the model sometimes emits newlines inside a field,
  // and every field in this model is single-line by design (bullets are a list).
  return v.replace(/\s+/g, " ").trim().slice(0, max);
}

/** Like `str` but keeps paragraph breaks (used for the summary / details). */
function text(v, max) {
  if (typeof v !== "string") return "";
  return v
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

function list(v, max) {
  return Array.isArray(v) ? v.slice(0, max) : [];
}

function strList(v, max, itemMax) {
  return list(v, max)
    .map((s) => str(s, itemMax))
    .filter(Boolean);
}

/** Reuse an incoming id when it looks sane, otherwise mint one. */
function keepId(v, prefix) {
  const id = typeof v === "string" ? v.trim().slice(0, 64) : "";
  return id || resumeId(prefix);
}

// --- sections ------------------------------------------------------------

function normalizeContact(raw) {
  const c = raw && typeof raw === "object" ? raw : {};
  return {
    name: str(c.name, RESUME_LIMITS.short),
    title: str(c.title, RESUME_LIMITS.short),
    email: str(c.email, RESUME_LIMITS.line),
    phone: str(c.phone, RESUME_LIMITS.short),
    location: str(c.location, RESUME_LIMITS.line),
    links: list(c.links, RESUME_LIMITS.maxLinks)
      .map((l) => {
        // Tolerate a bare string link as well as { label, url }.
        if (typeof l === "string") {
          const url = str(l, RESUME_LIMITS.line);
          return { label: url, url };
        }
        const o = l && typeof l === "object" ? l : {};
        return {
          label: str(o.label, RESUME_LIMITS.short),
          url: str(o.url, RESUME_LIMITS.line),
        };
      })
      .map((l) => ({ label: l.label || l.url, url: l.url }))
      .filter((l) => l.label || l.url),
  };
}

function normalizeExperience(raw) {
  return list(raw, RESUME_LIMITS.maxExperience)
    .map((e) => {
      const o = e && typeof e === "object" ? e : {};
      return {
        id: keepId(o.id, "exp"),
        role: str(o.role ?? o.title, RESUME_LIMITS.short),
        company: str(o.company ?? o.employer, RESUME_LIMITS.short),
        location: str(o.location, RESUME_LIMITS.line),
        start: str(o.start, RESUME_LIMITS.short),
        end: str(o.end, RESUME_LIMITS.short),
        bullets: strList(o.bullets, RESUME_LIMITS.maxBullets, RESUME_LIMITS.bullet),
      };
    })
    .filter((e) => e.role || e.company || e.bullets.length > 0);
}

function normalizeEducation(raw) {
  return list(raw, RESUME_LIMITS.maxEducation)
    .map((e) => {
      const o = e && typeof e === "object" ? e : {};
      return {
        id: keepId(o.id, "edu"),
        school: str(o.school ?? o.institution, RESUME_LIMITS.short),
        degree: str(o.degree, RESUME_LIMITS.line),
        location: str(o.location, RESUME_LIMITS.line),
        start: str(o.start, RESUME_LIMITS.short),
        end: str(o.end, RESUME_LIMITS.short),
        details: text(o.details, RESUME_LIMITS.details),
      };
    })
    .filter((e) => e.school || e.degree);
}

function normalizeSkills(raw) {
  return list(raw, RESUME_LIMITS.maxSkillGroups)
    .map((g) => {
      const o = g && typeof g === "object" ? g : {};
      return {
        id: keepId(o.id, "skl"),
        category: str(o.category ?? o.name, RESUME_LIMITS.short),
        items: strList(o.items, RESUME_LIMITS.maxSkillItems, RESUME_LIMITS.short),
      };
    })
    .filter((g) => g.items.length > 0 || g.category);
}

function normalizeProjects(raw) {
  return list(raw, RESUME_LIMITS.maxProjects)
    .map((p) => {
      const o = p && typeof p === "object" ? p : {};
      return {
        id: keepId(o.id, "prj"),
        name: str(o.name ?? o.title, RESUME_LIMITS.short),
        link: str(o.link ?? o.url, RESUME_LIMITS.line),
        bullets: strList(o.bullets, RESUME_LIMITS.maxBullets, RESUME_LIMITS.bullet),
      };
    })
    .filter((p) => p.name || p.bullets.length > 0);
}

function normalizeCertifications(raw) {
  return list(raw, RESUME_LIMITS.maxCertifications)
    .map((c) => {
      const o = c && typeof c === "object" ? c : {};
      return {
        id: keepId(o.id, "crt"),
        name: str(o.name, RESUME_LIMITS.line),
        issuer: str(o.issuer, RESUME_LIMITS.short),
        year: str(o.year, RESUME_LIMITS.short),
      };
    })
    .filter((c) => c.name);
}

/**
 * Coerce any input into a valid resume document. Never throws.
 * @param {unknown} raw
 * @returns {object} a complete, capped resume
 */
export function normalizeResume(raw) {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  return {
    contact: normalizeContact(r.contact),
    summary: text(r.summary, RESUME_LIMITS.summary),
    experience: normalizeExperience(r.experience),
    education: normalizeEducation(r.education),
    skills: normalizeSkills(r.skills),
    projects: normalizeProjects(r.projects),
    certifications: normalizeCertifications(r.certifications),
  };
}

/** True when the document has nothing in it worth rendering. */
export function isResumeEmpty(resume) {
  const r = resume || {};
  const c = r.contact || {};
  return (
    !c.name &&
    !c.title &&
    !c.email &&
    !c.phone &&
    !c.location &&
    (c.links?.length ?? 0) === 0 &&
    !r.summary &&
    (r.experience?.length ?? 0) === 0 &&
    (r.education?.length ?? 0) === 0 &&
    (r.skills?.length ?? 0) === 0 &&
    (r.projects?.length ?? 0) === 0 &&
    (r.certifications?.length ?? 0) === 0
  );
}

const SECTION_KEYS = [
  "contact",
  "summary",
  "experience",
  "education",
  "skills",
  "projects",
  "certifications",
];

/**
 * Reads one model turn into `{ reply, resume }`, where `resume` is null when
 * nothing should change.
 *
 * The prompt asks for `{ "reply": ..., "resume": ... }`, and stronger models
 * comply. Smaller ones — including the `:free` tiers this app is often pointed
 * at — routinely drop the envelope and return the resume document by itself. In
 * that case the reply is missing but the document is perfectly good, so throwing
 * it away would lose the user's whole turn. This tolerates both shapes, in the
 * same spirit as `parseJsonLoose` tolerating fenced JSON.
 *
 * @param {unknown} raw parsed model output
 * @returns {{ reply: string, resume: object|null }}
 */
export function interpretModelTurn(raw) {
  const obj = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const reply =
    typeof obj.reply === "string" && obj.reply.trim() ? obj.reply.trim() : "";

  // The intended envelope. `resume: null` explicitly means "nothing changed".
  if ("resume" in obj) {
    const doc =
      obj.resume != null && typeof obj.resume === "object" && !Array.isArray(obj.resume)
        ? obj.resume
        : null;
    return { reply, resume: doc };
  }

  // Envelope dropped: the object IS the resume.
  if (SECTION_KEYS.some((k) => k in obj)) {
    return { reply, resume: obj };
  }

  // Just a conversational reply (or unusable output) — leave the document alone.
  return { reply, resume: null };
}

/**
 * Validates the chat history posted by the client. Returns `{ messages }` on
 * success or `{ error }` with a user-safe message.
 *
 * Only the last `maxHistoryMessages` turns are kept — the whole history is
 * re-sent to the model on every turn, so this bounds both the request body and
 * the per-call token cost.
 */
export function validateChatHistory(raw) {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { error: "Send a message to start building your resume." };
  }

  const { maxHistoryMessages, maxMessageLength } = config.resume;

  const cleaned = raw
    .filter((m) => m && typeof m === "object")
    .map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: typeof m.content === "string" ? m.content.trim() : "",
    }))
    .filter((m) => m.content)
    .map((m) => ({ ...m, content: m.content.slice(0, maxMessageLength) }));

  if (cleaned.length === 0) {
    return { error: "Send a message to start building your resume." };
  }

  const messages = cleaned.slice(-maxHistoryMessages);

  if (messages[messages.length - 1].role !== "user") {
    return { error: "The last message must be from you." };
  }

  return { messages };
}
