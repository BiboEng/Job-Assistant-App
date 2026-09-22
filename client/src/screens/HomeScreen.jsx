import { useEffect, useMemo, useState } from "react";
import InterviewCard from "../components/InterviewCard.jsx";
import Icon from "../components/Icon.jsx";
import SurveyBanner from "../components/SurveyBanner.jsx";
import { listInterviews, deleteInterview } from "../api/historyApi.js";
import { scoreBand } from "../utils/score.js";
import styles from "./HomeScreen.module.css";

// Shown only in the empty state — see below.
const STEPS = [
  "Paste a job description.",
  "Answer by voice or text, against a timer.",
  "Get a scored report.",
];

const SORTS = {
  recent: { label: "Newest first", fn: (a, b) => b.createdAt - a.createdAt },
  best: { label: "Highest score", fn: (a, b) => b.overallScore - a.overallScore },
  worst: { label: "Lowest score", fn: (a, b) => a.overallScore - b.overallScore },
};

export default function HomeScreen({
  onStartNew,
  onOpenInterview,
  onFindJobs,
  onBuildResume,
  showSurveyPrompt = false,
  onTakeSurvey,
  onSkipSurvey,
}) {
  const [interviews, setInterviews] = useState(null); // null = loading
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState("recent");

  useEffect(() => {
    let cancelled = false;
    setError("");
    setInterviews(null);
    listInterviews()
      .then((data) => {
        if (!cancelled) setInterviews(Array.isArray(data) ? data : []);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message);
          setInterviews([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleDelete(id) {
    setActionError("");
    try {
      await deleteInterview(id);
      setInterviews((list) => list.filter((it) => it.id !== id));
    } catch (err) {
      setActionError(err.message || "Could not delete that interview.");
      throw err; // let the card reset its confirm state
    }
  }

  const loading = interviews === null;
  const all = interviews ?? [];
  const hasHistory = !loading && all.length > 0;

  // Averaged over every saved interview, not the filtered view — the strip
  // describes the user's practice record, not the current search.
  const stats = useMemo(() => {
    if (all.length === 0) return null;
    const scores = all.map((it) => it.overallScore || 0);
    const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    const best = Math.max(...scores);
    // "Trend" compares the three most recent against the three before them —
    // enough to be meaningful, short enough to move.
    const byDate = [...all].sort((a, b) => b.createdAt - a.createdAt);
    const recent = byDate.slice(0, 3).map((i) => i.overallScore || 0);
    const prior = byDate.slice(3, 6).map((i) => i.overallScore || 0);
    const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const delta = prior.length > 0 ? Math.round(mean(recent) - mean(prior)) : null;
    return { count: all.length, avg, best, delta };
  }, [all]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? all.filter(
          (it) =>
            (it.title || "").toLowerCase().includes(q) ||
            (it.snippet || "").toLowerCase().includes(q)
        )
      : all;
    return [...filtered].sort(SORTS[sortKey].fn);
  }, [all, query, sortKey]);

  return (
    <div className={styles.wrap}>
      {/* The dashboard used to open with the landing page's pitch all over
          again — headline, lede and a "how it works" list — which pushed the
          three actions and the history below the fold on a page you see every
          visit. The sell belongs on the front door; this is the workbench. */}
      <h1 className={styles.title}>Your dashboard</h1>

      {/* Shown only to an account with no survey row at all. Taking it or
          skipping it both write one, so this is genuinely once — after that the
          survey lives in the account menu. */}
      {showSurveyPrompt && (
        <SurveyBanner onTake={onTakeSurvey} onSkip={onSkipSurvey} />
      )}

      {/* Three peers, not one action and two afterthoughts. */}
      <section className={styles.features} aria-label="What you can do">
        <FeatureCard
          icon="messageSquare"
          title="Mock interview"
          body="Role-specific questions, on a timer, scored."
          action="Start an interview"
          onClick={onStartNew}
          featured
        />
        <FeatureCard
          icon="briefcase"
          title="Job matches"
          body="Real openings near you, ranked against your resume."
          action="Find job matches"
          onClick={onFindJobs}
        />
        <FeatureCard
          icon="fileText"
          title="Resume builder"
          body="Write an ATS-friendly resume with an assistant."
          action="Build a resume"
          onClick={onBuildResume}
        />
      </section>

      <section className={styles.historySection}>
        <div className={styles.header}>
          <h2 className={styles.heading}>
            Practice history
            {hasHistory && <span className={styles.countBadge}>{all.length}</span>}
          </h2>
          {hasHistory && (
            <button className="btn-ghost btn-sm" onClick={onStartNew}>
              <Icon name="plus" size={15} />
              New interview
            </button>
          )}
        </div>

        {hasHistory && stats && (
          <div className={styles.stats}>
            <Stat label="Interviews" value={stats.count} />
            <Stat
              label="Average score"
              value={stats.avg}
              color={scoreBand(stats.avg).color}
            />
            <Stat label="Best" value={stats.best} color={scoreBand(stats.best).color} />
            {stats.delta !== null && (
              <Stat
                label="Recent trend"
                value={`${stats.delta > 0 ? "+" : ""}${stats.delta}`}
                color={
                  stats.delta > 0
                    ? "var(--band-strong)"
                    : stats.delta < 0
                    ? "var(--band-weak)"
                    : "var(--text-muted)"
                }
                hint="last 3 vs. the 3 before"
              />
            )}
          </div>
        )}

        {error && (
          <div className="error-banner" role="alert">
            <Icon name="alert" size={16} />
            <span>Couldn't load your history: {error}</span>
          </div>
        )}

        {actionError && (
          <div className="error-banner" role="alert">
            <Icon name="alert" size={16} />
            <span>{actionError}</span>
          </div>
        )}

        {loading && (
          <div className={styles.list} aria-hidden="true">
            <div className={`skeleton ${styles.skelCard}`} />
            <div className={`skeleton ${styles.skelCard}`} />
          </div>
        )}
        {loading && <p className="sr-only">Loading your practice history…</p>}

        {/* The only place the three steps still earn their space: someone who
            hasn't run an interview yet doesn't know what one involves. */}
        {!loading && !hasHistory && !error && (
          <div className={styles.empty}>
            <span className={styles.emptyIcon} aria-hidden="true">
              <Icon name="target" size={22} />
            </span>
            <h3 className={styles.emptyTitle}>No interviews yet</h3>
            <ol className={styles.steps}>
              {STEPS.map((s, i) => (
                <li key={i}>
                  <span className={styles.stepNum} aria-hidden="true">
                    {i + 1}
                  </span>
                  {s}
                </li>
              ))}
            </ol>
            <button className="btn-primary" onClick={onStartNew}>
              Start your first interview
            </button>
          </div>
        )}

        {hasHistory && (
          <>
            {all.length > 2 && (
              <div className={styles.filterBar}>
                <div className={styles.searchField}>
                  <Icon name="search" size={15} className={styles.searchIcon} />
                  <input
                    type="search"
                    className={styles.search}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search by role or description"
                    aria-label="Search your practice history"
                  />
                </div>
                <label className={styles.sortField}>
                  <span className="sr-only">Sort history</span>
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
              </div>
            )}

            {visible.length === 0 ? (
              <p className={styles.state}>
                No interviews match “{query.trim()}”.{" "}
                <button type="button" className="link-btn" onClick={() => setQuery("")}>
                  Clear search
                </button>
              </p>
            ) : (
              <div className={styles.list}>
                {visible.map((it) => (
                  <InterviewCard
                    key={it.id}
                    interview={it}
                    onOpen={() => onOpenInterview(it.id)}
                    onDelete={() => handleDelete(it.id)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function FeatureCard({ icon, title, body, action, onClick, featured = false }) {
  return (
    <button
      type="button"
      className={`${styles.feature} ${featured ? styles.featured : ""}`}
      onClick={onClick}
    >
      <span className={styles.featureIcon} aria-hidden="true">
        <Icon name={icon} size={19} />
      </span>
      <span className={styles.featureTitle}>{title}</span>
      <span className={styles.featureBody}>{body}</span>
      <span className={styles.featureAction}>
        {action}
        <Icon name="chevronRight" size={15} />
      </span>
    </button>
  );
}

function Stat({ label, value, color, hint }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statValue} style={color ? { color } : undefined}>
        {value}
      </span>
      <span className={styles.statLabel}>{label}</span>
      {hint && <span className={styles.statHint}>{hint}</span>}
    </div>
  );
}
