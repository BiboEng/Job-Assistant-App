import { useEffect, useMemo, useRef, useState } from "react";
import JobCard from "../components/JobCard.jsx";
import { searchJobs, scoreJobs } from "../api/jobsApi.js";
import { extractResumeText } from "../utils/parseResume.js";
import {
  JOBS_STORAGE_KEY,
  JOBS_SCORE_BATCH_SIZE,
  MIN_RESUME_LENGTH,
  MAX_RESUME_LENGTH,
  ADZUNA_COUNTRIES,
  DEFAULT_ADZUNA_COUNTRY,
} from "../constants.js";
import styles from "./JobMatchesScreen.module.css";

const COUNTRY_CODES = new Set(ADZUNA_COUNTRIES.map((c) => c.code));

// Cached resume text is PII, so it doesn't live in localStorage forever — after
// this long the resume (only) is dropped and the user re-uploads. City/country
// (not sensitive) are kept.
const RESUME_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function loadSaved() {
  try {
    const raw = localStorage.getItem(JOBS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object") {
      const fresh =
        typeof parsed.savedAt === "number" &&
        Date.now() - parsed.savedAt < RESUME_TTL_MS;
      return {
        resumeText:
          fresh && typeof parsed.resumeText === "string" ? parsed.resumeText : "",
        fileName: fresh && typeof parsed.fileName === "string" ? parsed.fileName : "",
        city: typeof parsed.city === "string" ? parsed.city : "",
        country: COUNTRY_CODES.has(parsed.country)
          ? parsed.country
          : DEFAULT_ADZUNA_COUNTRY,
      };
    }
  } catch {
    // ignore unreadable / blocked storage
  }
  return { resumeText: "", fileName: "", city: "", country: DEFAULT_ADZUNA_COUNTRY };
}

function persist(resumeText, fileName, city, country) {
  try {
    localStorage.setItem(
      JOBS_STORAGE_KEY,
      JSON.stringify({ resumeText, fileName, city, country, savedAt: Date.now() })
    );
  } catch {
    // storage blocked — the feature still works for this session
  }
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const SORTS = {
  match: { label: "Best match", fn: (a, b) => scoreOf(b) - scoreOf(a) },
  recent: {
    label: "Most recent",
    fn: (a, b) => new Date(b.postedAt || 0) - new Date(a.postedAt || 0),
  },
};
const scoreOf = (j) => (Number.isFinite(j.matchScore) ? j.matchScore : -1);

export default function JobMatchesScreen({ onBack, cachedResult, onResult }) {
  const saved = useRef(null);
  if (saved.current === null) saved.current = loadSaved();

  const [resumeText, setResumeText] = useState(saved.current.resumeText);
  const [fileName, setFileName] = useState(saved.current.fileName);
  const [city, setCity] = useState(saved.current.city);
  const [country, setCountry] = useState(saved.current.country);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState("");

  // idle | searching | scoring | done | error
  const [status, setStatus] = useState(cachedResult ? "done" : "idle");
  const [error, setError] = useState("");
  const [result, setResult] = useState(cachedResult ?? null);
  const [scoreProgress, setScoreProgress] = useState({ done: 0, total: 0 });
  const [sortKey, setSortKey] = useState("match");

  const fileInputRef = useRef(null);
  // Bumped on every new search so a stale batch loop from a previous run (or one
  // still resolving after unmount) can detect it's been superseded and bail.
  const runIdRef = useRef(0);

  useEffect(() => () => { runIdRef.current += 1; }, []);

  const resumeLen = resumeText.trim().length;
  const resumeReady = resumeLen >= MIN_RESUME_LENGTH && resumeLen <= MAX_RESUME_LENGTH;
  const cityReady = city.trim().length >= 2;
  const running = status === "searching" || status === "scoring";
  const canSearch = resumeReady && cityReady && !running && !parsing;

  function updateCity(value) {
    setCity(value);
    persist(resumeText, fileName, value, country);
  }
  function updateCountry(value) {
    setCountry(value);
    persist(resumeText, fileName, city, value);
  }
  function clearResume() {
    setResumeText("");
    setFileName("");
    setParseError("");
    persist("", "", city, country);
  }

  async function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setParsing(true);
    setParseError("");
    try {
      const text = await extractResumeText(file);
      const trimmed = text.trim();
      if (trimmed.length < MIN_RESUME_LENGTH) {
        throw new Error(
          `Only ${trimmed.length} characters of text were found in that file — too short to match on. Try a different export of your resume.`
        );
      }
      const next = trimmed.slice(0, MAX_RESUME_LENGTH);
      setResumeText(next);
      setFileName(file.name);
      persist(next, file.name, city, country);
    } catch (err) {
      setParseError(err.message || "Couldn't read that file.");
    } finally {
      setParsing(false);
    }
  }

  function mergeScores(scores) {
    setResult((prev) => {
      if (!prev) return prev;
      const byId = new Map(scores.map((s) => [s.id, s]));
      return {
        ...prev,
        jobs: prev.jobs.map((j) =>
          byId.has(j.id)
            ? { ...j, matchScore: byId.get(j.id).matchScore, reason: byId.get(j.id).reason }
            : j
        ),
      };
    });
  }

  async function scoreAll(jobs, resume, runId) {
    const pending = jobs.filter((j) => !Number.isFinite(j.matchScore));
    if (pending.length === 0) {
      setStatus("done");
      return;
    }
    setStatus("scoring");
    setScoreProgress({ done: 0, total: pending.length });

    const batches = chunk(pending, JOBS_SCORE_BATCH_SIZE);
    let completed = 0;
    for (const batch of batches) {
      if (runIdRef.current !== runId) return; // superseded / unmounted
      try {
        const { scores } = await scoreJobs({
          resumeText: resume,
          jobs: batch.map((j) => ({
            id: j.id,
            company: j.company,
            title: j.title,
            location: j.location,
            description: j.description,
          })),
        });
        if (runIdRef.current !== runId) return;
        mergeScores(scores);
      } catch {
        if (runIdRef.current !== runId) return;
        // Leave this batch unscored; the "Score remaining" button can retry.
        mergeScores(batch.map((j) => ({ id: j.id, matchScore: null, reason: "" })));
      }
      completed += batch.length;
      setScoreProgress({ done: completed, total: pending.length });
    }
    if (runIdRef.current === runId) setStatus("done");
  }

  async function handleSearch() {
    if (!canSearch) return;
    const runId = ++runIdRef.current;
    const resume = resumeText.trim();

    setStatus("searching");
    setError("");
    setResult(null);
    setSortKey("match");
    onResult?.(null);

    try {
      const data = await searchJobs({ resumeText: resume, city: city.trim(), country });
      if (runIdRef.current !== runId) return;

      const base = {
        profile: data.profile,
        warnings: data.warnings || [],
        message: data.message || null,
        jobs: (data.jobs || []).map((j) => ({ ...j, matchScore: null })),
      };
      setResult(base);

      if (base.jobs.length === 0) {
        setStatus("done");
        onResult?.(base);
        return;
      }
      await scoreAll(base.jobs, resume, runId);
    } catch (err) {
      if (runIdRef.current !== runId) return;
      setError(err.message || "Something went wrong finding matches.");
      setStatus("error");
    }
  }

  async function scoreRemaining() {
    if (!result || running) return;
    const runId = ++runIdRef.current;
    await scoreAll(result.jobs, resumeText.trim(), runId);
  }

  // Cache the finished result up to the app once scoring settles.
  useEffect(() => {
    if (status === "done" && result) onResult?.(result);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const jobs = result?.jobs ?? [];
  const unscoredCount = jobs.filter((j) => !Number.isFinite(j.matchScore)).length;

  const sortedJobs = useMemo(() => {
    // Hold Adzuna's relevance order while scores are still streaming in so cards
    // don't jump around; only apply the chosen sort once scoring has settled.
    if (status !== "done") return jobs;
    return [...jobs].sort(SORTS[sortKey].fn);
  }, [jobs, sortKey, status]);

  return (
    <div className={styles.wrap}>
      {onBack && (
        <button type="button" className={`btn-ghost ${styles.back}`} onClick={onBack}>
          ← Back to home
        </button>
      )}

      <div className={styles.card}>
        <h2 className={styles.heading}>Job Matches</h2>
        <p className={styles.sub}>
          Add your resume and a city — we'll search current job listings and
          score each role against your resume. Your resume is used only for the
          search; it's never shown or saved to your history.
        </p>

        {parseError && (
          <div className="error-banner" role="alert">
            {parseError}
          </div>
        )}

        <div className={styles.controls}>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.txt,.md,application/pdf,text/plain"
            className="sr-only"
            id="resume-file"
            onChange={handleFile}
          />

          {fileName ? (
            <div className={styles.confirm}>
              <span className={styles.check} aria-hidden="true">✓</span>
              <span className={styles.confirmText}>
                <strong>{fileName}</strong> uploaded
                <span className={styles.confirmCount}>
                  {" "}· {resumeLen.toLocaleString()} characters
                </span>
              </span>
              <button type="button" className="btn-ghost" onClick={clearResume}>
                Remove
              </button>
            </div>
          ) : (
            <div className={styles.uploadRow}>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => fileInputRef.current?.click()}
                disabled={parsing}
              >
                {parsing ? "Reading…" : "Upload resume"}
              </button>
              <span className={styles.count}>PDF or .txt</span>
            </div>
          )}

          <div className={styles.locationRow}>
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="country-input">
                Country
              </label>
              <select
                id="country-input"
                className={styles.select}
                value={country}
                onChange={(e) => updateCountry(e.target.value)}
              >
                {ADZUNA_COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="city-input">
                City
              </label>
              <input
                id="city-input"
                className={styles.city}
                type="text"
                value={city}
                onChange={(e) => updateCity(e.target.value)}
                placeholder="e.g. Austin, TX"
                maxLength={80}
              />
            </div>
          </div>

          <button
            type="button"
            className="btn-primary"
            onClick={handleSearch}
            disabled={!canSearch}
          >
            {running ? "Finding matches…" : "Find job matches"}
          </button>
        </div>
      </div>

      {status === "searching" && (
        <p className={styles.state}>Searching job listings…</p>
      )}

      {status === "scoring" && (
        <p className={styles.state} role="status">
          Scoring roles against your resume — {scoreProgress.done} of{" "}
          {scoreProgress.total} done. Results appear as they're scored.
        </p>
      )}

      {status === "error" && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}

      {result && (status === "scoring" || status === "done") && (
        <div className={styles.results}>
          {result.profile?.field && (
            <p className={styles.profile}>
              Matched as{" "}
              <strong>
                {[result.profile.seniority, result.profile.field]
                  .filter(Boolean)
                  .join(" · ")}
              </strong>
              {result.profile.keywords?.length > 0 &&
                ` — ${result.profile.keywords.slice(0, 6).join(", ")}`}
            </p>
          )}

          {result.warnings?.length > 0 && (
            <div className={styles.warn} role="status">
              {result.warnings.map((w, i) => (
                <div key={i}>{w}</div>
              ))}
            </div>
          )}

          {jobs.length === 0 ? (
            <div className={styles.empty}>
              <p>{result.message || "No matching jobs found."}</p>
              <p className={styles.emptyHint}>
                Try a larger nearby city, or broaden the wording in your resume.
              </p>
            </div>
          ) : (
            <>
              <div className={styles.resultsBar}>
                <span className={styles.count}>
                  {jobs.length} role{jobs.length === 1 ? "" : "s"}
                </span>
                {status === "done" && (
                  <label className={styles.sortField}>
                    <span className="sr-only">Sort roles</span>
                    <select
                      className={styles.sortSelect}
                      value={sortKey}
                      onChange={(e) => setSortKey(e.target.value)}
                    >
                      {Object.entries(SORTS).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>

              {status === "done" && unscoredCount > 0 && (
                <div className={styles.warn} role="status">
                  {unscoredCount} role{unscoredCount === 1 ? " couldn't" : "s couldn't"} be
                  scored (the AI service was rate limited).{" "}
                  <button type="button" className={styles.linkBtn} onClick={scoreRemaining}>
                    Score remaining
                  </button>
                </div>
              )}

              <div className={styles.list}>
                {sortedJobs.map((job) => (
                  <JobCard
                    key={job.id}
                    job={job}
                    scoring={status === "scoring" && !Number.isFinite(job.matchScore)}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
