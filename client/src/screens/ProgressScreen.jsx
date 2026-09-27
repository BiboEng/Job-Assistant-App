import { useCallback, useEffect, useRef, useState } from "react";
import Icon from "../components/Icon.jsx";
import ScoreTrendChart from "../components/ScoreTrendChart.jsx";
import { getProgress, getRoleThemes } from "../api/progressApi.js";
import { scoreBand } from "../utils/score.js";
import styles from "./ProgressScreen.module.css";

// While the server is still naming roles in the background, re-fetch this
// often, this many times, to pick the labels up.
const LABEL_POLL_MS = 6000;
const LABEL_POLL_MAX = 5;

function formatDate(ts) {
  return new Date(ts).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Progress: the user's interview history grouped by role (the server names
 * each interview's role — see "Progress" in CLAUDE.md), one role at a time.
 *
 * Left, the roles as a vertical tab list; right, the selected role's score
 * trend and its recurring feedback themes. Deliberately per-role only — there
 * is no combined view, since a score for a data-analyst interview says nothing
 * about progress towards a frontend one.
 *
 * Like the other screens it knows nothing about URLs: the selected role comes
 * in as `selectedRole` (AppWorkspace keeps it in `?role=`) and goes out
 * through `onSelectRole`.
 */
export default function ProgressScreen({
  onStartNew,
  onOpenInterview,
  selectedRole,
  onSelectRole,
}) {
  const [data, setData] = useState(null); // null = loading
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timer;
    let polls = 0;

    function load(initial) {
      if (initial) {
        setError("");
        setData(null);
      }
      getProgress()
        .then((res) => {
          if (cancelled) return;
          setData({ roles: Array.isArray(res?.roles) ? res.roles : [], labelling: Boolean(res?.labelling) });
          if (res?.labelling && polls < LABEL_POLL_MAX) {
            polls += 1;
            timer = setTimeout(() => load(false), LABEL_POLL_MS);
          }
        })
        .catch((err) => {
          if (cancelled) return;
          // A failed background poll keeps what's on screen.
          if (initial) {
            setError(err.message);
            setData({ roles: [], labelling: false });
          }
        });
    }

    load(true);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [reloadKey]);

  const loading = data === null;
  const roles = data?.roles ?? [];
  const role = roles.find((r) => r.key === selectedRole) ?? roles[0] ?? null;

  return (
    <div className={styles.wrap}>
      <header className="page-head">
        <div>
          <h1>Progress</h1>
          <p className="page-sub">How your interview scores are moving, role by role.</p>
        </div>
        <button type="button" className="btn-primary" onClick={onStartNew}>
          <Icon name="plus" />
          New interview
        </button>
      </header>

      {error && (
        <div className="error-banner" role="alert">
          <Icon name="alert" />
          <span>Couldn't load your progress: {error}</span>
          <button type="button" className="btn-ghost btn-sm" onClick={() => setReloadKey((k) => k + 1)}>
            Try again
          </button>
        </div>
      )}

      {loading && (
        <div className={styles.layout} aria-hidden="true">
          <div className={styles.roleList}>
            <div className={`skeleton ${styles.skelRole}`} />
            <div className={`skeleton ${styles.skelRole}`} />
          </div>
          <div className={`skeleton ${styles.skelPanel}`} />
        </div>
      )}
      {loading && <p className="sr-only">Loading your progress…</p>}

      {!loading && !error && roles.length === 0 && (
        <div className="empty-state">
          <span className={styles.emptyIcon} aria-hidden="true">
            <Icon name="trendingUp" />
          </span>
          <h2>No progress to show yet</h2>
          <p>
            Complete a mock interview and your scores will appear here, grouped
            by the role you practised for.
          </p>
          <button type="button" className="btn-primary" onClick={onStartNew}>
            <Icon name="plus" />
            Start a mock interview
          </button>
        </div>
      )}

      {!loading && roles.length > 0 && role && (
        <>
          {data.labelling && (
            <p className={styles.labelling} role="status">
              <Icon name="clock" />
              Still sorting some interviews into roles. This page updates when it's done.
            </p>
          )}
          <div className={styles.layout}>
            <RoleTabs roles={roles} activeKey={role.key} onSelect={onSelectRole} />
            <RolePanel key={role.key} role={role} onOpenInterview={onOpenInterview} />
          </div>
        </>
      )}
    </div>
  );
}

/* --- the role list ---------------------------------------------------------- */

/**
 * A vertical tablist: arrow keys move between roles (roving tabindex), and
 * selection follows focus — each role is cheap to show.
 */
function RoleTabs({ roles, activeKey, onSelect }) {
  const refs = useRef(new Map());

  function onKeyDown(e, index) {
    const moves = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };
    let next = null;
    if (e.key in moves) next = (index + moves[e.key] + roles.length) % roles.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = roles.length - 1;
    if (next === null) return;
    e.preventDefault();
    onSelect(roles[next].key);
    refs.current.get(roles[next].key)?.focus();
  }

  return (
    <div className={styles.roleList} role="tablist" aria-orientation="vertical" aria-label="Roles">
      {roles.map((r, i) => {
        const selected = r.key === activeKey;
        const band = scoreBand(r.latestScore);
        return (
          <button
            key={r.key}
            ref={(el) => (el ? refs.current.set(r.key, el) : refs.current.delete(r.key))}
            type="button"
            role="tab"
            id={`role-tab-${i}`}
            aria-selected={selected}
            aria-controls="role-panel"
            tabIndex={selected ? 0 : -1}
            className={`${styles.roleTab} ${selected ? styles.roleTabActive : ""}`}
            onClick={() => onSelect(r.key)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            <span className={styles.roleMain}>
              <span className={styles.roleTitle}>{r.title}</span>
              <span className={styles.roleMeta}>
                {plural(r.count, "interview")} · {formatDate(r.latestAt)}
              </span>
            </span>
            <span
              className={`${styles.pill} mono`}
              style={{ color: band.color, background: band.soft }}
              title={`Latest score: ${band.label}`}
            >
              {r.latestScore}
              <span className="sr-only"> latest score out of 100</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* --- one role ----------------------------------------------------------------- */

function RolePanel({ role, onOpenInterview }) {
  const single = role.count === 1;
  const first = role.interviews[0];

  return (
    <section
      id="role-panel"
      role="tabpanel"
      aria-labelledby="role-panel-title"
      className={styles.panel}
    >
      <header className={styles.panelHead}>
        <h2 id="role-panel-title" className={styles.panelTitle}>
          {role.title}
        </h2>
        <p className={styles.panelMeta}>
          {single
            ? `1 interview · ${formatDate(first.createdAt)}`
            : `${role.count} interviews · ${formatDate(first.createdAt)} – ${formatDate(role.latestAt)}`}
        </p>
      </header>

      <dl className={styles.stats}>
        <Stat label="Latest" value={role.latestScore} />
        {!single && <Stat label="Average" value={role.averageScore} />}
        {!single && <Stat label="Best" value={role.bestScore} />}
        {!single && (
          <Stat
            label="Since first"
            value={`${role.change > 0 ? "+" : ""}${role.change}`}
            tone={role.change > 0 ? "up" : role.change < 0 ? "down" : null}
            hint="Latest score minus your first score for this role"
          />
        )}
      </dl>

      <div className={styles.block}>
        <h3 className={styles.blockTitle}>Score trend</h3>
        {single ? (
          <div className={styles.singleTrend}>
            <p>
              Complete more interviews for this role to see your trend. So far you
              have one, scored <span className="mono">{first.overallScore}</span>.
            </p>
            <button type="button" className="link-btn" onClick={() => onOpenInterview(first.id)}>
              Open that interview
            </button>
          </div>
        ) : (
          <ScoreTrendChart
            interviews={role.interviews}
            onOpenInterview={onOpenInterview}
            label={`Score per interview for ${role.title}, oldest to newest`}
          />
        )}
      </div>

      <Themes role={role} />
    </section>
  );
}

function Stat({ label, value, tone, hint }) {
  return (
    <div className={styles.stat} title={hint}>
      <dt className={styles.statLabel}>{label}</dt>
      <dd
        className={`${styles.statValue} ${tone === "up" ? styles.up : tone === "down" ? styles.down : ""}`}
      >
        {value}
      </dd>
    </div>
  );
}

/* --- recurring themes --------------------------------------------------------- */

// Per browser tab, so flipping between roles doesn't re-request. Keyed by the
// exact interview set, like the server's cache, so a new interview refetches.
const themeCache = new Map();

function Themes({ role }) {
  const ids = role.interviews.map((i) => i.id);
  const cacheKey = `${role.key}|${ids.join(",")}`;
  const [state, setState] = useState(() =>
    themeCache.has(cacheKey)
      ? { status: "done", data: themeCache.get(cacheKey) }
      : { status: "loading" }
  );
  const [attempt, setAttempt] = useState(0);

  const load = useCallback(
    (signal) => {
      getRoleThemes(role.key, { signal })
        .then((data) => {
          themeCache.set(cacheKey, data);
          setState({ status: "done", data });
        })
        .catch((err) => {
          if (err.aborted) return;
          setState({ status: "error", message: err.message });
        });
    },
    [role.key, cacheKey]
  );

  useEffect(() => {
    if (themeCache.has(cacheKey)) {
      setState({ status: "done", data: themeCache.get(cacheKey) });
      return undefined;
    }
    const controller = new AbortController();
    setState({ status: "loading" });
    load(controller.signal);
    return () => controller.abort();
  }, [cacheKey, attempt, load]);

  const data = state.data;
  const single = role.count === 1;

  return (
    <div className={styles.block}>
      <h3 className={styles.blockTitle}>
        {single ? "Feedback from this interview" : "Recurring feedback"}
      </h3>

      {state.status === "loading" && (
        <>
          <p className={styles.note} role="status">
            {single ? "Loading feedback…" : `Summarising feedback across ${plural(role.count, "interview")}…`}
          </p>
          <div className={styles.themeGrid} aria-hidden="true">
            <div className={`skeleton ${styles.skelTheme}`} />
            <div className={`skeleton ${styles.skelTheme}`} />
          </div>
        </>
      )}

      {state.status === "error" && (
        <div className="error-banner" role="alert">
          <Icon name="alert" />
          <span>Couldn't summarise feedback for this role: {state.message}</span>
          <button type="button" className="btn-ghost btn-sm" onClick={() => setAttempt((a) => a + 1)}>
            Try again
          </button>
        </div>
      )}

      {state.status === "done" && data && (
        <>
          {!data.single && data.totalCount > data.interviewCount && (
            <p className={styles.note}>
              Based on your {data.interviewCount} most recent interviews for this role.
            </p>
          )}
          <div className={styles.themeGrid}>
            <ThemeList
              kind="strengths"
              title="Strengths"
              themes={data.strengths}
              data={data}
            />
            <ThemeList
              kind="weaknesses"
              title="To work on"
              themes={data.weaknesses}
              data={data}
            />
          </div>
        </>
      )}
    </div>
  );
}

/**
 * One side of the themes. Recurring themes (in 2+ interviews) lead, each with
 * the count and a row of dots — one per interview, oldest first, filled where
 * the theme came up — so a weakness that has stopped appearing reads as fixed.
 * One-off themes are folded into a single muted line beneath.
 */
function ThemeList({ kind, title, themes, data }) {
  const icon = kind === "strengths" ? "check" : "target";

  if (data.single) {
    return (
      <div className={styles.themeCol}>
        <h4 className={styles.themeHead}>
          <Icon name={icon} />
          {title}
        </h4>
        {themes.length === 0 ? (
          <p className={styles.none}>None noted.</p>
        ) : (
          <ul className={styles.plainList}>
            {themes.map((t) => (
              <li key={t.theme}>{t.theme}</li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  const recurring = themes.filter((t) => t.count >= 2);
  const once = themes.filter((t) => t.count < 2);

  return (
    <div className={styles.themeCol}>
      <h4 className={styles.themeHead}>
        <Icon name={icon} />
        {title}
      </h4>

      {recurring.length === 0 ? (
        <p className={styles.none}>
          {kind === "strengths"
            ? "No strength has come up in more than one interview yet."
            : "Nothing has come up in more than one interview yet."}
        </p>
      ) : (
        <ul className={styles.themes}>
          {recurring.map((t) => (
            <li key={t.theme} className={styles.theme}>
              <span className={styles.themeText}>{t.theme}</span>
              <span className={styles.themeMeta}>
                <span className={styles.count}>
                  Mentioned in {t.count} of {data.interviewCount} interviews
                </span>
                <MentionDots ids={data.interviewIds} hits={t.interviewIds} kind={kind} />
              </span>
            </li>
          ))}
        </ul>
      )}

      {once.length > 0 && (
        <p className={styles.once}>
          <span className={styles.onceLabel}>Mentioned once:</span>{" "}
          {once.map((t) => t.theme).join(" · ")}
        </p>
      )}
    </div>
  );
}

function MentionDots({ ids, hits, kind }) {
  const set = new Set(hits);
  return (
    <span className={styles.dots} aria-hidden="true" title="Each dot is one interview, oldest first">
      {ids.map((id) => (
        <span
          key={id}
          className={`${styles.mdot} ${set.has(id) ? (kind === "strengths" ? styles.mdotGood : styles.mdotWeak) : ""}`}
        />
      ))}
    </span>
  );
}
