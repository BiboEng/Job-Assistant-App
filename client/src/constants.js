// Shared UI constants. Keep the length limits in sync with server/src/config.js.
export const MIN_JD_LENGTH = 30;
export const MAX_JD_LENGTH = 8000;
export const MAX_ANSWER_LENGTH = 5000;

// Optional resume pasted into interview setup. Keep in sync with
// maxInterviewResumeLength in server/src/config.js.
export const MAX_INTERVIEW_RESUME_LENGTH = 6000;

// Interview question count — keep in sync with min/max/totalQuestions in
// server/src/config.js.
export const QUESTION_COUNT_MIN = 2;
export const QUESTION_COUNT_MAX = 6;
export const QUESTION_COUNT_DEFAULT = 3;

// Interview focus presets. `value` and `label` must stay in sync with
// `interviewFocuses` in server/src/config.js; `short` and `hint` are UI-only —
// `short` labels the segmented control, `hint` explains the choice underneath
// it, because "System design" alone doesn't tell you what you'll be asked.
export const INTERVIEW_FOCUSES = [
  {
    value: "mixed",
    label: "Mixed (behavioral + technical)",
    short: "Mixed",
    hint: "A realistic blend — some “tell me about a time”, some role-specific depth.",
  },
  {
    value: "behavioral",
    label: "Behavioral",
    short: "Behavioral",
    hint: "Past situations, teamwork, conflict and impact. Answer in STAR form.",
  },
  {
    value: "technical",
    label: "Technical / role-specific",
    short: "Technical",
    hint: "Craft questions drawn from the tools and responsibilities in the posting.",
  },
  {
    value: "system-design",
    label: "System design",
    short: "System design",
    hint: "Open-ended architecture problems — trade-offs, scale and failure modes.",
  },
];

// How the candidate answers. `value` must stay in sync with `interviewModes` in
// server/src/config.js; everything else is UI-only. Speak mode needs camera +
// microphone and measures delivery (pace, pauses, eye contact) in the browser;
// Type mode is the original behaviour and asks for no permissions at all.
export const INTERVIEW_MODES = [
  {
    value: "type",
    label: "Type",
    hint: "Answer in writing. Feedback covers what you said.",
  },
  {
    value: "speak",
    label: "Speak",
    hint: "Answer out loud on camera. Feedback also covers how you came across.",
  },
];

export const DEFAULT_INTERVIEW_MODE = "type";

// Client-side request timeout. Kept comfortably above the server's worst case
// (one upstream call ~30s; feedback may retry once on an unparseable response)
// so a genuine server error surfaces before the client gives up.
export const REQUEST_TIMEOUT_MS = 60000;

// Job Matches now runs as short calls (one search call ~= profile model call +
// Adzuna; then small scoring batches), so the old ~100s ceiling isn't needed.
// 60s covers a slow upstream model on the search call. Keep in sync with server
// jobMatch tuning in server/src/config.js.
export const JOBS_REQUEST_TIMEOUT_MS = 60000;

// Jobs the client asks the server to score per /jobs/score call. Keep at or
// below JOB_MATCH_SCORE_BATCH_MAX in server/src/config.js.
export const JOBS_SCORE_BATCH_SIZE = 4;

// Resume text limits. Keep in sync with minResumeLength / maxResumeLength in
// server/src/config.js.
export const MIN_RESUME_LENGTH = 120;
export const MAX_RESUME_LENGTH = 20000;

// Where the uploaded resume + city + country are cached so Job Matches survives
// a reload.
export const JOBS_STORAGE_KEY = "mockInterview:jobs:v1";

// Where the scored results themselves are mirrored. A full search costs ~13
// model calls, so a reload that threw them away made the free tier's rate limit
// much worse. sessionStorage, not localStorage: results go stale fast, and this
// way they don't outlive the tab. Cleared on sign-out alongside the other keys.
export const JOBS_RESULT_KEY = "mockInterview:jobsResult:v1";

// Countries Adzuna serves job listings for. Keep in sync with
// `adzuna.supportedCountries` in server/src/config.js. Alphabetical by label.
export const ADZUNA_COUNTRIES = [
  { code: "au", label: "Australia" },
  { code: "at", label: "Austria" },
  { code: "be", label: "Belgium" },
  { code: "br", label: "Brazil" },
  { code: "ca", label: "Canada" },
  { code: "fr", label: "France" },
  { code: "de", label: "Germany" },
  { code: "in", label: "India" },
  { code: "it", label: "Italy" },
  { code: "mx", label: "Mexico" },
  { code: "nl", label: "Netherlands" },
  { code: "nz", label: "New Zealand" },
  { code: "pl", label: "Poland" },
  { code: "sg", label: "Singapore" },
  { code: "za", label: "South Africa" },
  { code: "es", label: "Spain" },
  { code: "ch", label: "Switzerland" },
  { code: "gb", label: "United Kingdom" },
  { code: "us", label: "United States" },
];

export const DEFAULT_ADZUNA_COUNTRY = "us";

// Resume Builder. Keep in sync with the `resume` block in server/src/config.js.
export const RESUME_REQUEST_TIMEOUT_MS = 60000;
export const RESUME_MAX_MESSAGE_LENGTH = 2000;
// Turns kept client-side; the server independently caps what it forwards to the
// model, this just stops the request body growing without bound.
export const RESUME_MAX_HISTORY_MESSAGES = 14;

// Resume document caps. Keep in sync with RESUME_LIMITS in
// server/src/services/resume.service.js — the server re-validates everything, so
// these exist to keep the UI from letting you build something it will reject.
export const RESUME_LIMITS = {
  short: 120,
  line: 200,
  bullet: 400,
  summary: 1500,
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

// Where the in-progress interview is cached so a refresh doesn't lose it.
export const STORAGE_KEY = "mockInterview:v1";

// Seed from a random offset so ids minted after a reload can't collide with
// ids restored from sessionStorage in the same millisecond.
let counter = Math.floor(Math.random() * 1e6);
/** Stable-enough id for list keys / messages. */
export function nextId() {
  counter += 1;
  return `${Date.now().toString(36)}-${counter}`;
}
