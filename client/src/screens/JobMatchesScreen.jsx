import { useEffect, useMemo, useRef, useState } from "react";
import JobRow from "../components/JobRow.jsx";
import Icon from "../components/Icon.jsx";
import { searchJobs, scoreJobs } from "../api/jobsApi.js";
import { extractResumeText } from "../utils/parseResume.js";
import {
  JOBS_STORAGE_KEY,
  JOBS_RESULT_KEY,
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

/**
 * The scored results, mirrored to sessionStorage. A search is ~13 model calls,
 * so losing them to a refresh was expensive — especially on the free tier,
 * where the re-run comes back with more `null` scores than the first one did.
 */
function loadCachedResult() {
  try {
    const raw = sessionStorage.getItem(JOBS_RESULT_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && Array.isArray(parsed.jobs) ? parsed : null;
  } catch {
    return null;
  }
}

function persistResult(result) {
  try {
    if (result) sessionStorage.setItem(JOBS_RESULT_KEY, JSON.stringify(result));
    else sessionStorage.removeItem(JOBS_RESULT_KEY);
  } catch {
    // storage blocked / quota — the in-memory copy still works for this visit
  }
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const scoreOf = (j) => (Number.isFinite(j.matchScore) ? j.matchScore : -1);
const postedAtOf = (j) => (j.postedAt ? new Date(j.postedAt).getTime() || 0 : 0);

const SORTS = {
  match: {
    label: "Best match",
    // Recency breaks the tie. Match score alone happily floats a year-old
    // listing to the top of the page, and a role that isn't open any more is
    // worth nothing however well it fits.
    fn: (a, b) => scoreOf(b) - scoreOf(a) || postedAtOf(b) - postedAtOf(a),
  },
  recent: {
    label: "Most recent",
    fn: (a, b) => postedAtOf(b) - postedAtOf(a),
  },
};

const POSTED_WINDOWS = [
  { value: "any", label: "Any time" },
  { value: "3", label: "Past 3 days" },
  { value: "7", label: "Past week" },
  { value: "30", label: "Past month" },
];

const SCORE_FLOORS = [
  { value: "0", label: "Any score" },
  { value: "50", label: "50+" },
  { value: "75", label: "75+" },
];

const DEFAULT_FILTERS = {
  minScore: "0",
  posted: "any",
  salaryOnly: false,
  remoteOnly: false,
};

export default function JobMatchesScreen({ onBack, cachedResult, onResult }) {
  const saved = useRef(null);
  if (saved.current === null) saved.current = loadSaved();

  const [resumeText, setResumeText] = useState(saved.current.resumeText);
  const [fileName, setFileName] = useState(saved.current.fileName);
  const [city, setCity] = useState(saved.current.city);
  const [country, setCountry] = useState(saved.current.country);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState("");
  const [dragging, setDragging] = useState(false);

  // The workspace keeps the result across in-app navigation; sessionStorage
  // covers the case the workspace can't — a full page reload.
  const initialResult = useRef(null);
  if (initialResult.current === null) {
    initialResult.current = cachedResult ?? loadCachedResult() ?? false;
  }
  const restored = initialResult.current || null;

  // idle | searching | scoring | done | error
  const [status, setStatus] = useState(restored ? "done" : "idle");
  const [error, setError] = useState("");
  const [result, setResult] = useState(restored);
  const [scoreProgress, setScoreProgress] = useState({ done: 0, total: 0, inFlight: 0 });
  const [sortKey, setSortKey] = useState("match");
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  // The search form stays expanded until there's something to show; after that
  // "Change search" brings it back.
  const [formOpen, setFormOpen] = useState(!restored);

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

  /**
   * Reads one resume file. Note what is NOT here: the extracted text never
   * reaches a rendered field. The only visible trace is the filename and a
   * character count — see the note in CLAUDE.md.
   */
  async function ingestFile(file) {
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

  function handleFileInput(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    ingestFile(file);
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragging(false);
    if (parsing) return;
    ingestFile(e.dataTransfer?.files?.[0]);
  }

  /**
   * `settled` records that a scoring attempt came back for this job, whether it
   * produced a number or not. The card's spinner keys off that rather than off
   * the run status: a role the model declined mid-run used to show "Scoring…"
   * next to "Couldn't score this role" until the whole run finished.
   */
  function mergeScores(scores) {
    setResult((prev) => {
      if (!prev) return prev;
      const byId = new Map(scores.map((s) => [s.id, s]));
      return {
        ...prev,
        jobs: prev.jobs.map((j) =>
          byId.has(j.id)
            ? {
                ...j,
                matchScore: byId.get(j.id).matchScore,
                reason: byId.get(j.id).reason,
                settled: true,
              }
            : j
        ),
      };
    });
  }

  /** Put the jobs about to be re-scored back into the pending state. */
  function markPending(pending) {
    const ids = new Set(pending.map((j) => j.id));
    setResult((prev) =>
      prev
        ? {
            ...prev,
            jobs: prev.jobs.map((j) => (ids.has(j.id) ? { ...j, settled: false } : j)),
          }
        : prev
    );
  }

  async function scoreAll(jobs, resume, runId) {
    const pending = jobs.filter((j) => !Number.isFinite(j.matchScore));
    if (pending.length === 0) {
      setStatus("done");
      return;
    }
    markPending(pending);
    setStatus("scoring");
    setScoreProgress({ done: 0, total: pending.length, inFlight: 0 });

    const batches = chunk(pending, JOBS_SCORE_BATCH_SIZE);
    let completed = 0;
    for (const batch of batches) {
      if (runIdRef.current !== runId) return; // superseded / unmounted
      // The server answers a whole batch at once, so "done" can only move in
      // steps of JOBS_SCORE_BATCH_SIZE. Naming the batch in flight keeps the
      // panel from sitting on "0 of 12" for twenty seconds.
      setScoreProgress({ done: completed, total: pending.length, inFlight: batch.length });
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
      setScoreProgress({ done: completed, total: pending.length, inFlight: 0 });
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
    setFilters(DEFAULT_FILTERS);
    onResult?.(null);
    persistResult(null);

    try {
      const data = await searchJobs({ resumeText: resume, city: city.trim(), country });
      if (runIdRef.current !== runId) return;

      const base = {
        profile: data.profile,
        warnings: data.warnings || [],
        message: data.message || null,
        city: city.trim(),
        country,
        jobs: (data.jobs || []).map((j) => ({ ...j, matchScore: null })),
      };
      setResult(base);

      if (base.jobs.length === 0) {
        setStatus("done");
        onResult?.(base);
        return;
      }
      setFormOpen(false); // results are the page now
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

  // Cache the finished result — up to the workspace (survives navigation) and
  // into sessionStorage (survives a reload).
  useEffect(() => {
    if (status === "done" && result) {
      onResult?.(result);
      persistResult(result);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const jobs = result?.jobs ?? [];
  const unscoredCount = jobs.filter((j) => !Number.isFinite(j.matchScore)).length;
  const filtersActive =
    filters.minScore !== "0" ||
    filters.posted !== "any" ||
    filters.salaryOnly ||
    filters.remoteOnly;

  const sortedJobs = useMemo(() => {
    // Hold Adzuna's relevance order while scores are still streaming in so cards
    // don't jump around; only filter and sort once scoring has settled.
    if (status !== "done") return jobs;

    const floor = Number(filters.minScore);
    const days = filters.posted === "any" ? null : Number(filters.posted);
    const cutoff = days ? Date.now() - days * 24 * 60 * 60 * 1000 : null;

    const filtered = jobs.filter((j) => {
      if (floor > 0 && !(Number.isFinite(j.matchScore) && j.matchScore >= floor)) {
        return false;
      }
      if (cutoff && !(j.postedAt && new Date(j.postedAt).getTime() >= cutoff)) {
        return false;
      }
      if (filters.salaryOnly && !j.salary) return false;
      // Filters what came back rather than changing the search — Adzuna's query
      // is city-scoped server-side.
      if (filters.remoteOnly) {
        const hay = `${j.location || ""} ${j.title || ""}`.toLowerCase();
        if (!hay.includes("remote") && !hay.includes("work from home")) return false;
      }
      return true;
    });

    return [...filtered].sort(SORTS[sortKey].fn);
  }, [jobs, sortKey, status, filters]);

  const countryLabel = ADZUNA_COUNTRIES.find((c) => c.code === result?.country)?.label;
  const scorePct = scoreProgress.total
    ? Math.round((scoreProgress.done / scoreProgress.total) * 100)
    : 0;
  // Collapse only once there is something below to look at — never while the
  // search is still running, where the button is the thing giving feedback.
  const collapsed = !formOpen && !!result && !running;

  return (
    <div className={styles.wrap}>
      <header className="page-head">
        <h1>Job Matches</h1>
        {collapsed && (
          <button type="button" className="btn-ghost" onClick={() => setFormOpen(true)}>
            <Icon name="search" />
            Change search
          </button>
        )}
      </header>

      {/* Once results are on screen the form is no longer the point of the page,
          so it folds into a one-line summary instead of holding ~450px above
          every result. */}
      {collapsed ? (
        <div className={styles.searchSummary}>
          <span className={styles.summaryItem}>
            <Icon name="fileText" />
            {fileName || "Your resume"}
          </span>
          <span className={styles.summaryItem}>
            <Icon name="mapPin" />
            {result?.city || city}
            {countryLabel ? `, ${countryLabel}` : ""}
          </span>
          {result?.profile?.field && (
            <span className={styles.summaryItem}>
              <Icon name="target" />
              {[result.profile.seniority, result.profile.field].filter(Boolean).join(" · ")}
            </span>
          )}
        </div>
      ) : (
      <div className={styles.card}>
        <p className={styles.sub}>
          Your resume becomes the search. It is never shown on screen or saved.
        </p>

        {parseError && (
          <div className="error-banner" role="alert">
            <Icon name="alert" />
            <span>{parseError}</span>
          </div>
        )}

        <div className={styles.controls}>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.txt,.md,application/pdf,text/plain"
            className="sr-only"
            id="resume-file"
            onChange={handleFileInput}
          />

          {fileName ? (
            <div className={styles.confirm}>
              <span className={styles.check} aria-hidden="true">
                <Icon name="check" />
              </span>
              <span className={styles.confirmText}>
                <strong>{fileName}</strong>
                <span className={styles.confirmCount}>
                  {resumeLen.toLocaleString()} characters read
                </span>
              </span>
              <button type="button" className="btn-ghost btn-sm" onClick={clearResume}>
                Replace
              </button>
            </div>
          ) : (
            /* A real drop target. The old version was a button labelled
               "Upload resume", which gave no hint that dragging worked. */
            <div
              className={`${styles.dropzone} ${dragging ? styles.dropzoneActive : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              onClick={() => !parsing && fileInputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
              aria-label="Upload your resume — PDF or plain text"
            >
              <span className={styles.dropIcon} aria-hidden="true">
                <Icon name={parsing ? "refresh" : "upload"} />
              </span>
              <span className={styles.dropTitle}>
                {parsing ? "Reading your resume…" : "Drop your resume here"}
              </span>
              <span className={styles.dropHint}>
                {parsing ? "This happens in your browser" : "or click to browse · PDF or .txt"}
              </span>
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
            className={`btn-primary ${styles.searchBtn}`}
            onClick={handleSearch}
            disabled={!canSearch}
          >
            <Icon name="search" />
            {running ? "Finding matches…" : "Find job matches"}
          </button>
        </div>
      </div>
      )}

      {status === "searching" && (
        <div className={styles.progressCard} role="status">
          <span className={styles.progressLabel}>Searching job listings…</span>
          <div className={`${styles.track} ${styles.trackIndeterminate}`} aria-hidden="true">
            <div className={styles.trackBlip} />
          </div>
        </div>
      )}

      {status === "scoring" && (
        <div className={styles.progressCard} role="status">
          <span className={styles.progressLabel}>
            Scored {scoreProgress.done} of {scoreProgress.total}
            {scoreProgress.inFlight > 0
              ? ` — scoring ${scoreProgress.inFlight} more now.`
              : "."}{" "}
            Results appear as they land.
          </span>
          <div
            className={styles.track}
            role="progressbar"
            aria-valuenow={scorePct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className={styles.trackFill} style={{ width: `${scorePct}%` }} />
            {/* The batch in flight, shimmering ahead of the solid fill — so the
                bar isn't frozen for the twenty seconds a batch takes. */}
            {scoreProgress.inFlight > 0 && scoreProgress.total > 0 && (
              <div
                className={styles.trackPending}
                style={{
                  left: `${scorePct}%`,
                  width: `${Math.min(
                    100 - scorePct,
                    (scoreProgress.inFlight / scoreProgress.total) * 100
                  )}%`,
                }}
                aria-hidden="true"
              />
            )}
          </div>
        </div>
      )}

      {status === "error" && (
        <div className="error-banner" role="alert">
          <Icon name="alert" />
          <span>{error}</span>
        </div>
      )}

      {result && (status === "scoring" || status === "done") && (
        <div className={styles.results}>
          {/* The profile the model pulled from the resume — what was searched. */}
          {result.profile?.keywords?.length > 0 && (
            <div className={styles.keywords} aria-label="Search keywords">
              {result.profile.keywords.slice(0, 6).map((k) => (
                <span key={k} className={styles.keyword}>
                  {k}
                </span>
              ))}
            </div>
          )}

          {result.warnings?.length > 0 && (
            <div className="warn-banner" role="status">
              <Icon name="alert" />
              <div>
                {result.warnings.map((w, i) => (
                  <div key={i}>{w}</div>
                ))}
              </div>
            </div>
          )}

          {jobs.length === 0 ? (
            <div className={styles.empty}>
              <p className={styles.emptyTitle}>
                {result.message || "No matching jobs found."}
              </p>
              <p className={styles.emptyHint}>
                Try a larger nearby city, or broaden the wording in your resume.
              </p>
            </div>
          ) : (
            <>
              <div className={styles.resultsBar}>
                <span className={styles.resultCount}>
                  <strong>{sortedJobs.length}</strong>
                  {filtersActive && ` of ${jobs.length}`} role
                  {sortedJobs.length === 1 ? "" : "s"}
                </span>

                {status === "done" && (
                  <div className={styles.filters}>
                    <label className={styles.filterField}>
                      <span className="sr-only">Minimum match score</span>
                      <select
                        className={styles.filterSelect}
                        value={filters.minScore}
                        onChange={(e) =>
                          setFilters((f) => ({ ...f, minScore: e.target.value }))
                        }
                      >
                        {SCORE_FLOORS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className={styles.filterField}>
                      <span className="sr-only">Posted within</span>
                      <select
                        className={styles.filterSelect}
                        value={filters.posted}
                        onChange={(e) =>
                          setFilters((f) => ({ ...f, posted: e.target.value }))
                        }
                      >
                        {POSTED_WINDOWS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <FilterToggle
                      active={filters.salaryOnly}
                      onClick={() =>
                        setFilters((f) => ({ ...f, salaryOnly: !f.salaryOnly }))
                      }
                    >
                      Has salary
                    </FilterToggle>

                    <FilterToggle
                      active={filters.remoteOnly}
                      onClick={() =>
                        setFilters((f) => ({ ...f, remoteOnly: !f.remoteOnly }))
                      }
                    >
                      Remote
                    </FilterToggle>

                    <label className={styles.filterField}>
                      <span className="sr-only">Sort roles</span>
                      <select
                        className={styles.filterSelect}
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
                  </div>
                )}
              </div>

              {status === "done" && unscoredCount > 0 && (
                <div className="warn-banner" role="status">
                  <Icon name="alert" />
                  <span>
                    {unscoredCount} role{unscoredCount === 1 ? " couldn't" : "s couldn't"} be
                    scored (the AI service was rate limited).
                  </span>
                  <button type="button" className="link-btn" onClick={scoreRemaining}>
                    Score remaining
                  </button>
                </div>
              )}

              {sortedJobs.length === 0 ? (
                <div className={styles.empty}>
                  <p className={styles.emptyTitle}>No roles match these filters.</p>
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => setFilters(DEFAULT_FILTERS)}
                  >
                    Clear filters
                  </button>
                </div>
              ) : (
                <ul className={styles.list}>
                  {sortedJobs.map((job) => (
                    <JobRow
                      key={job.id}
                      job={job}
                      scoring={status === "scoring" && !job.settled}
                    />
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function FilterToggle({ active, onClick, children }) {
  return (
    <button
      type="button"
      className={`${styles.filterToggle} ${active ? styles.filterToggleOn : ""}`}
      onClick={onClick}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}
