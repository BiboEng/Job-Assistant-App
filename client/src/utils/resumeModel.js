import { RESUME_LIMITS } from "../constants.js";

/**
 * Client-side helpers for the resume document — the single source of truth the
 * preview renders from, manual edits write to, the chat sends up, and the
 * exporters read.
 *
 * The document shape is defined (and authoritatively enforced) in
 * server/src/services/resume.service.js. Everything here is about editing it
 * immutably; the server re-normalizes whatever we send.
 */

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

let counter = Math.floor(Math.random() * 1e6);
/** Local id for a newly added entry. The server preserves ids it is given. */
export function newId(prefix) {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}`;
}

/** Blank entries for the "+ Add" buttons in the preview. */
export const BLANK = {
  experience: () => ({
    id: newId("exp"),
    role: "",
    company: "",
    location: "",
    start: "",
    end: "",
    bullets: [""],
  }),
  education: () => ({
    id: newId("edu"),
    school: "",
    degree: "",
    location: "",
    start: "",
    end: "",
    details: "",
  }),
  skills: () => ({ id: newId("skl"), category: "", items: [] }),
  projects: () => ({ id: newId("prj"), name: "", link: "", bullets: [""] }),
  certifications: () => ({ id: newId("crt"), name: "", issuer: "", year: "" }),
};

const MAX_ENTRIES = {
  experience: RESUME_LIMITS.maxExperience,
  education: RESUME_LIMITS.maxEducation,
  skills: RESUME_LIMITS.maxSkillGroups,
  projects: RESUME_LIMITS.maxProjects,
  certifications: RESUME_LIMITS.maxCertifications,
};

/** True when `section` is already at its cap. */
export function sectionFull(resume, section) {
  const max = MAX_ENTRIES[section];
  return max != null && (resume[section]?.length ?? 0) >= max;
}

// --- immutable updates ---------------------------------------------------

export function setContactField(resume, field, value) {
  return { ...resume, contact: { ...resume.contact, [field]: value } };
}

export function setSummary(resume, value) {
  return { ...resume, summary: value };
}

/** Replace one field on one entry of a list section. */
export function setEntryField(resume, section, id, field, value) {
  return {
    ...resume,
    [section]: resume[section].map((e) =>
      e.id === id ? { ...e, [field]: value } : e
    ),
  };
}

export function addEntry(resume, section) {
  if (sectionFull(resume, section)) return resume;
  return { ...resume, [section]: [...resume[section], BLANK[section]()] };
}

export function removeEntry(resume, section, id) {
  return { ...resume, [section]: resume[section].filter((e) => e.id !== id) };
}

/** Move an entry up (-1) or down (+1) within its section. */
export function moveEntry(resume, section, id, delta) {
  const list = resume[section];
  const from = list.findIndex((e) => e.id === id);
  const to = from + delta;
  if (from === -1 || to < 0 || to >= list.length) return resume;
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return { ...resume, [section]: next };
}

// --- bullets (experience + projects share the shape) ---------------------

export function setBullet(resume, section, id, index, value) {
  return {
    ...resume,
    [section]: resume[section].map((e) =>
      e.id === id
        ? { ...e, bullets: e.bullets.map((b, i) => (i === index ? value : b)) }
        : e
    ),
  };
}

/** Insert a blank bullet after `index` (or at the end when index is omitted). */
export function addBullet(resume, section, id, index) {
  return {
    ...resume,
    [section]: resume[section].map((e) => {
      if (e.id !== id || e.bullets.length >= RESUME_LIMITS.maxBullets) return e;
      const at = index == null ? e.bullets.length : index + 1;
      const bullets = [...e.bullets];
      bullets.splice(at, 0, "");
      return { ...e, bullets };
    }),
  };
}

export function removeBullet(resume, section, id, index) {
  return {
    ...resume,
    [section]: resume[section].map((e) =>
      e.id === id ? { ...e, bullets: e.bullets.filter((_, i) => i !== index) } : e
    ),
  };
}

// --- skills --------------------------------------------------------------

/**
 * Skill items are edited as one comma-separated line, which is how people
 * actually type them, then split back into the array the model works with.
 */
export function skillItemsToText(items) {
  return (items || []).join(", ");
}

export function skillItemsFromText(value) {
  return String(value)
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, RESUME_LIMITS.maxSkillItems);
}

// --- links ---------------------------------------------------------------

export function setLink(resume, index, field, value) {
  return {
    ...resume,
    contact: {
      ...resume.contact,
      links: resume.contact.links.map((l, i) =>
        i === index ? { ...l, [field]: value } : l
      ),
    },
  };
}

export function addLink(resume) {
  if (resume.contact.links.length >= RESUME_LIMITS.maxLinks) return resume;
  return {
    ...resume,
    contact: { ...resume.contact, links: [...resume.contact.links, { label: "", url: "" }] },
  };
}

export function removeLink(resume, index) {
  return {
    ...resume,
    contact: {
      ...resume.contact,
      links: resume.contact.links.filter((_, i) => i !== index),
    },
  };
}

// --- misc ----------------------------------------------------------------

export function isResumeEmpty(resume) {
  const c = resume?.contact ?? {};
  return (
    !c.name &&
    !c.title &&
    !c.email &&
    !c.phone &&
    !c.location &&
    (c.links?.length ?? 0) === 0 &&
    !resume?.summary &&
    (resume?.experience?.length ?? 0) === 0 &&
    (resume?.education?.length ?? 0) === 0 &&
    (resume?.skills?.length ?? 0) === 0 &&
    (resume?.projects?.length ?? 0) === 0 &&
    (resume?.certifications?.length ?? 0) === 0
  );
}

/** Filename stem for downloads: "Ada Lovelace" -> "ada-lovelace-resume". */
export function resumeFileStem(resume) {
  const name = (resume?.contact?.name || "").trim().toLowerCase();
  const slug = name.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return slug ? `${slug}-resume` : "resume";
}

/** Date range label, e.g. "Mar 2021 — Present". */
export function dateRange(start, end) {
  const s = (start || "").trim();
  const e = (end || "").trim();
  if (s && e) return `${s} — ${e}`;
  return s || e;
}
