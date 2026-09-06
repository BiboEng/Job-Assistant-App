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

// Interview focus presets — keep in sync with `interviewFocuses` in
// server/src/config.js.
export const INTERVIEW_FOCUSES = [
  { value: "mixed", label: "Mixed (behavioral + technical)" },
  { value: "behavioral", label: "Behavioral" },
  { value: "technical", label: "Technical / role-specific" },
  { value: "system-design", label: "System design" },
];

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
