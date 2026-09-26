import { useEffect, useMemo, useState } from "react";
import InterviewRow from "../components/InterviewRow.jsx";
import Icon from "../components/Icon.jsx";
import SurveyBanner from "../components/SurveyBanner.jsx";
import { listInterviews, deleteInterview } from "../api/historyApi.js";
import { scoreBand } from "../utils/score.js";
import styles from "./HomeScreen.module.css";

const SORTS = {
  recent: { label: "Newest first", fn: (a, b) => b.createdAt - a.createdAt },
  best: { label: "Highest score", fn: (a, b) => b.overallScore - a.overallScore },
  worst: { label: "Lowest score", fn: (a, b) => a.overallScore - b.overallScore },
};

/**
 * Home: the practice history as a dense table, with a one-line stats strip
 * above it. Job Matches and the Resume Builder are reached from the sidebar,
 * which is always on screen, so the page no longer spends its top half on
 * three feature cards pointing at them.
 */
export default function HomeScreen({
  onStartNew,
  onOpenInterview,
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
      throw err; // let the row reset its confirm state
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
      <header className="page-head">
        <h1>Home</h1>
        <button type="button" className="btn-primary" onClick={onStartNew}>
          <Icon name="plus" />
          New interview
        </button>
      </header>

      {/* Shown only to an account with no survey row at all. Taking it or
          skipping it both write one, so this is genuinely once — after that the
          survey lives in the account menu. */}
      {showSurveyPrompt && (
        <div className={styles.banner}>
          <SurveyBanner onTake={onTakeSurvey} onSkip={onSkipSurvey} />
        </div>
      )}

      {hasHistory && stats && (
        <dl className={styles.stats}>
          <Stat label="Interviews" value={stats.count} />
          <Stat label="Average" value={stats.avg} color={scoreBand(stats.avg).color} />
          <Stat label="Best" value={stats.best} color={scoreBand(stats.best).color} />
          {stats.delta !== null && (
            <Stat
              label="Trend"
              value={`${stats.delta > 0 ? "+" : ""}${stats.delta}`}
              color={
                stats.delta > 0
                  ? "var(--band-strong)"
                  : stats.delta < 0
                  ? "var(--band-weak)"
                  : "var(--text-muted)"
              }
              hint="Last 3 interviews vs. the 3 before"
            />
          )}
        </dl>
      )}

      <section className={styles.historySection} aria-labelledby="history-heading">
        <div className={styles.toolbar}>
          <h2 id="history-heading" className={styles.heading}>
            Practice history
            {hasHistory && <span className={styles.count}>{all.length}</span>}
          </h2>

          {hasHistory && all.length > 2 && (
            <div className={styles.controls}>
              <div className={styles.searchField}>
                <Icon name="search" className={styles.searchIcon} />
                <input
                  type="search"
                  className={styles.search}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search"
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
        </div>

        {error && (
          <div className="error-banner" role="alert">
            <Icon name="alert" />
            <span>Couldn't load your history: {error}</span>
          </div>
        )}

        {actionError && (
          <div className="error-banner" role="alert">
            <Icon name="alert" />
            <span>{actionError}</span>
          </div>
        )}

        {loading && (
          <div className={styles.table} aria-hidden="true">
            <div className={`skeleton ${styles.skelRow}`} />
            <div className={`skeleton ${styles.skelRow}`} />
            <div className={`skeleton ${styles.skelRow}`} />
          </div>
        )}
        {loading && <p className="sr-only">Loading your practice history…</p>}

        {!loading && !hasHistory && !error && (
          <div className={styles.empty}>
            <p>No interviews yet.</p>
            <button type="button" className="btn-primary" onClick={onStartNew}>
              Start new interview
            </button>
          </div>
        )}

        {hasHistory &&
          (visible.length === 0 ? (
            <p className={styles.state}>
              No interviews match “{query.trim()}”.{" "}
              <button type="button" className="link-btn" onClick={() => setQuery("")}>
                Clear search
              </button>
            </p>
          ) : (
            <div className={styles.table} role="list">
              <div className={styles.columns} aria-hidden="true">
                <span>Role</span>
                <span className={styles.colAnswered}>Answered</span>
                <span className={styles.colDate}>Date</span>
                <span className={styles.colScore}>Score</span>
                <span />
              </div>
              {visible.map((it) => (
                <InterviewRow
                  key={it.id}
                  interview={it}
                  onOpen={() => onOpenInterview(it.id)}
                  onDelete={() => handleDelete(it.id)}
                />
              ))}
            </div>
          ))}
      </section>
    </div>
  );
}

function Stat({ label, value, color, hint }) {
  return (
    <div className={styles.stat} title={hint}>
      <dt className={styles.statLabel}>{label}</dt>
      <dd className={styles.statValue} style={color ? { color } : undefined}>
        {value}
      </dd>
    </div>
  );
}
