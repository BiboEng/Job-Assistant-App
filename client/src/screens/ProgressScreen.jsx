import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Icon from "../components/Icon.jsx";
import PracticeAgainButton from "../components/PracticeAgainButton.jsx";
import ScoreTrendChart from "../components/ScoreTrendChart.jsx";
import { getProgress, getRoleThemes } from "../api/progressApi.js";
import UpgradeNotice from "../components/UpgradeNotice.jsx";
import { INTERVIEW_FOCUSES, RUBRIC_MAX } from "../constants.js";
import { rubricSeries, weakestDimension } from "../utils/rubric.js";
import { pctOf, scoreBand } from "../utils/score.js";
import styles from "./ProgressScreen.module.css";

// While the server is still naming roles in the background, re-fetch this
// often, this many times, to pick the labels up.
const LABEL_POLL_MS = 6000;
const LABEL_POLL_MAX = 5;

const RUBRIC_TICKS = [0, 5, 10];
const SPARK_W = 56;
const SPARK_H = 20;

function formatDate(ts) {
  return new Date(ts).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function shortDate(ts) {
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const signed = (n) => `${n > 0 ? "+" : n < 0 ? "−" : "±"}${Math.abs(n)}`;
const toneOf = (n) => (n > 0 ? "up" : n < 0 ? "down" : "flat");

/** "3 questions · Technical · typed" for the interview Practice again repeats. */
function formatOf(it) {
  const focus = INTERVIEW_FOCUSES.find((f) => f.value === it.focus)?.short;
  const mode = it.mode === "speak" ? "spoken" : it.mode === "type" ? "typed" : null;
  return [it.totalQuestions ? plural(it.totalQuestions, "question") : null, focus, mode]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Progress: the user's interview history grouped by role (the server names
 * each interview's role — see "Progress" in CLAUDE.md), one role at a time.
 *
 * Left, the roles as a vertical tab list, each with a sparkline of its scores.
 * Right, the selected role in four labelled sections: the overall score trend,
 * answer quality (the evaluator's four-dimension rubric, one small chart
 * each), the recurring feedback, and the role's interviews. Deliberately
 * per-role only — there is no combined view, since a score for a data-analyst
 * interview says nothing about progress towards a frontend one.
 *
 * Like the other screens it knows nothing about URLs: the selected role comes
 * in as `selectedRole` (AppWorkspace keeps it in `?role=`) and goes out
 * through `onSelectRole`. "Practice again" repeats the role's latest
 * interview through `onPracticeAgain(id)`.
 */
export default function ProgressScreen({
  onStartNew,
  onOpenInterview,
  onPracticeAgain,
  repeating = null,
  selectedRole,
  onSelectRole,
  insights = true,
  onOpenPlans,
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
          setData({
            roles: Array.isArray(res?.roles) ? res.roles : [],
            labelling: Boolean(res?.labelling),
            insights: res?.insights !== false,
          });
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
          <p className="page-sub">How your interviews are improving, role by role.</p>
        </div>
        <button type="button" className="btn-ghost" onClick={onStartNew} disabled={repeating !== null}>
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
          <div className={styles.rail}>
            <div className={`skeleton ${styles.skelRole}`} />
            <div className={`skeleton ${styles.skelRole}`} />
          </div>
          <div className={styles.main}>
            <div className={`skeleton ${styles.skelHead}`} />
            <div className={`skeleton ${styles.skelPanel}`} />
          </div>
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
            <RolePanel
              key={role.key}
              role={role}
              onOpenInterview={onOpenInterview}
              onPracticeAgain={onPracticeAgain}
              repeating={repeating}
              // The server says so too (it leaves the rubric out without it).
              insights={insights && data.insights !== false}
              onOpenPlans={onOpenPlans}
            />
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
    <div className={styles.rail}>
      <p className={styles.railHead} aria-hidden="true">
        <span>Roles</span>
        <span className="mono">{roles.length}</span>
      </p>
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
              <span className={styles.roleTitle}>{r.title}</span>
              <span
                className={`${styles.pill} mono`}
                style={{ color: band.color, background: band.soft }}
                title={`Latest score: ${band.label}`}
              >
                {r.latestScore}
                <span className="sr-only"> latest score out of 100</span>
              </span>
              <span className={styles.roleMeta}>
                {plural(r.count, "interview")} · {shortDate(r.latestAt)}
              </span>
              <Sparkline values={r.interviews.map((it) => it.overallScore)} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** A role's scores at a glance: a 56×20 line on the fixed 0–100 domain. */
function Sparkline({ values }) {
  if (values.length < 2) return null;
  const n = values.length;
  const pts = values.map((v, i) => [
    Math.round(((SPARK_W - 4) * i) / (n - 1) + 2),
    Math.round((SPARK_H - 3) * (1 - Math.min(100, Math.max(0, v)) / 100) + 1.5),
  ]);
  const [lx, ly] = pts[n - 1];
  return (
    <svg className={styles.spark} width={SPARK_W} height={SPARK_H} aria-hidden="true">
      <polyline points={pts.map((p) => p.join(",")).join(" ")} />
      <circle cx={lx} cy={ly} r="2" />
    </svg>
  );
}

/* --- one role ----------------------------------------------------------------- */

function RolePanel({ role, onOpenInterview, onPracticeAgain, repeating, insights = true, onOpenPlans }) {
  const single = role.count === 1;
  const first = role.interviews[0];
  const latest = role.interviews[role.interviews.length - 1];
  const format = formatOf(latest);

  return (
    <section
      id="role-panel"
      role="tabpanel"
      aria-labelledby="role-panel-title"
      className={styles.main}
    >
      <header className={styles.roleHead}>
        <div className={styles.roleHeadText}>
          <p className="eyebrow">Role</p>
          <h2 id="role-panel-title" className={styles.panelTitle}>
            {role.title}
          </h2>
          <p className={styles.panelMeta}>
            {single
              ? `1 interview · ${formatDate(first.createdAt)}`
              : `${role.count} interviews · ${formatDate(first.createdAt)} – ${formatDate(role.latestAt)}`}
          </p>
        </div>
        {onPracticeAgain && (
          <div className={styles.repeat}>
            <PracticeAgainButton
              onClick={() => onPracticeAgain(latest.id)}
              busy={repeating === latest.id}
              disabled={repeating !== null}
            />
            <span className={styles.repeatHint}>
              Same job description{format ? ` · ${format}` : ""}
            </span>
          </div>
        )}
      </header>

      <dl className={styles.kpis}>
        <Kpi label="Latest" value={role.latestScore} band />
        <Kpi label="Average" value={single ? "—" : role.averageScore} />
        <Kpi label="Best" value={single ? "—" : role.bestScore} />
        <Kpi
          label="Since first"
          value={role.change === null ? "—" : signed(role.change)}
          tone={role.change === null ? null : toneOf(role.change)}
          hint={
            role.change === null
              ? "Needs a second interview for this role"
              : "Latest score minus your first score for this role"
          }
        />
      </dl>

      <Section
        icon="trendingUp"
        title="Overall score"
        sub={single ? null : "Each interview, oldest to newest, out of 100. Select a point to open it."}
      >
        {single ? (
          <div className={styles.placeholder}>
            <p>
              Complete another interview for this role to see your trend. So far
              you have one, scored <span className="mono">{first.overallScore}</span>.
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
      </Section>

      {/* Pro and up. On Regular both sections stay visible, locked, so it's
          clear what the upgrade adds — and no themes request is made. */}
      {insights ? (
        <>
          <AnswerQuality role={role} onOpenInterview={onOpenInterview} />
          <Themes role={role} />
        </>
      ) : (
        <>
          <Section
            icon="gauge"
            title="Answer quality"
            sub="Relevance, specificity, structure and depth, charted across your interviews."
          >
            <UpgradeNotice
              compact
              message="Answer-quality trends are part of Pro and Ultimate."
              onOpenPlans={onOpenPlans}
            />
          </Section>
          <Section
            icon="sparkles"
            title="Recurring feedback"
            sub="The strengths and weaknesses that keep coming up across your interviews."
          >
            <UpgradeNotice
              compact
              message="Recurring feedback is part of Pro and Ultimate."
              onOpenPlans={onOpenPlans}
            />
          </Section>
        </>
      )}

      <Section icon="clipboard" title="Interviews" sub="Newest first.">
        <ol className={styles.history} reversed>
          {[...role.interviews].reverse().map((it, i, list) => {
            const band = scoreBand(it.overallScore);
            const prev = list[i + 1];
            const delta = prev ? it.overallScore - prev.overallScore : null;
            return (
              <li key={it.id}>
                <button type="button" className={styles.historyRow} onClick={() => onOpenInterview(it.id)}>
                  <span className={`${styles.historyN} mono`}>#{list.length - i}</span>
                  <span className={styles.historyMain}>
                    <span className={styles.historyTitle}>{it.jobTitle || role.title}</span>
                    <span className={styles.historyMeta}>
                      <time dateTime={new Date(it.createdAt).toISOString()}>{formatDate(it.createdAt)}</time>
                      {formatOf(it) ? ` · ${formatOf(it)}` : ""}
                    </span>
                  </span>
                  <span
                    className={`${styles.historyDelta} mono ${delta === null ? "" : styles[toneOf(delta)]}`}
                    title={delta === null ? undefined : "Change from the interview before"}
                  >
                    {delta === null ? "" : signed(delta)}
                  </span>
                  <span
                    className={`${styles.pill} mono`}
                    style={{ color: band.color, background: band.soft }}
                    title={band.label}
                  >
                    {it.overallScore}
                    <span className="sr-only"> out of 100, {band.label}</span>
                  </span>
                  <Icon name="chevronRight" />
                </button>
              </li>
            );
          })}
        </ol>
      </Section>
    </section>
  );
}

function Section({ icon, title, sub, aside, children }) {
  return (
    <section className={styles.section}>
      <header className={styles.sectionHead}>
        <div className={styles.sectionTitleWrap}>
          <h3 className={styles.sectionTitle}>
            <Icon name={icon} />
            {title}
          </h3>
          {sub && <p className={styles.sectionSub}>{sub}</p>}
        </div>
        {aside}
      </header>
      <div className={styles.sectionBody}>{children}</div>
    </section>
  );
}

function Kpi({ label, value, band, tone, hint }) {
  const b = band && typeof value === "number" ? scoreBand(value) : null;
  return (
    <div className={styles.kpi} title={hint}>
      <dt className={styles.kpiLabel}>{label}</dt>
      <dd className={styles.kpiValue}>
        <span className={tone ? styles[tone] : undefined}>{value}</span>
        {b && (
          <span className={styles.kpiBand}>
            <span className={styles.swatch} style={{ background: b.color }} aria-hidden="true" />
            {b.label}
          </span>
        )}
        {tone && tone !== "flat" && (
          <span className={styles[tone]} aria-hidden="true">
            <Icon name={tone === "up" ? "trendingUp" : "trendingDown"} />
          </span>
        )}
      </dd>
    </div>
  );
}

/* --- answer quality ------------------------------------------------------------ */

/**
 * The evaluator's four-dimension rubric as small multiples: one chart per
 * dimension on a fixed 0–10 domain, so each reads on its own and none needs a
 * legend or a colour of its own. Interviews saved before the rubric existed
 * aren't points (never zeros); the note says how many are covered.
 */
function AnswerQuality({ role, onOpenInterview }) {
  // Memoised so each chart gets a stable series and a re-render of this panel
  // doesn't reset its crosshair.
  const { rated, dimensions } = useMemo(() => rubricSeries(role.interviews), [role.interviews]);
  const weakest = weakestDimension(dimensions);

  return (
    <Section
      icon="gauge"
      title="Answer quality"
      sub={`How your answers were rated on four dimensions, each out of ${RUBRIC_MAX}.`}
    >
      {rated === 0 ? (
        <div className={styles.placeholder}>
          <p>
            Answer-quality ratings start with your next interview for this role.
            Interviews from before they were introduced don't have them.
          </p>
        </div>
      ) : (
        <>
          {rated < role.count && (
            <p className={styles.note}>
              Based on {rated} of {role.count} interviews. Earlier ones weren't rated on these.
            </p>
          )}
          <div className={styles.qualityGrid}>
            {dimensions.map((d) => (
              <Dimension
                key={d.key}
                dim={d}
                roleTitle={role.title}
                focus={weakest?.key === d.key}
                onOpenInterview={onOpenInterview}
              />
            ))}
          </div>
          {weakest && (
            <p className={styles.focusNote}>
              <Icon name="target" />
              <span>
                <strong>Focus next: {weakest.label}.</strong> {weakest.hint}. It's your
                lowest-rated dimension for this role, averaging{" "}
                <span className="mono">{weakest.average}</span>/{RUBRIC_MAX}.
              </span>
            </p>
          )}
        </>
      )}
    </Section>
  );
}

function Dimension({ dim, roleTitle, focus, onOpenInterview }) {
  const n = dim.points.length;
  const band = dim.latest === null ? null : scoreBand(pctOf(dim.latest, RUBRIC_MAX));

  return (
    <div className={`${styles.dim} ${focus ? styles.dimFocus : ""}`}>
      <div className={styles.dimHead}>
        <div className={styles.dimName}>
          <h4 className={styles.dimTitle}>{dim.label}</h4>
          <p className={styles.dimHint}>{dim.hint}</p>
        </div>
        <div className={styles.dimFigure}>
          <span className={styles.dimValue}>
            {dim.latest ?? "—"}
            <span className={styles.dimMax}>/{RUBRIC_MAX}</span>
          </span>
          {dim.change !== null ? (
            <span className={styles.dimChange} title="Change since your first rated interview">
              <span className={styles[toneOf(dim.change)]}>{signed(dim.change)}</span> since first
            </span>
          ) : band ? (
            <span className={styles.dimChange}>{band.label}</span>
          ) : null}
        </div>
      </div>

      {n >= 2 ? (
        <ScoreTrendChart
          compact
          interviews={dim.points}
          getValue={(p) => p.value}
          max={RUBRIC_MAX}
          ticks={RUBRIC_TICKS}
          valueName={dim.label}
          onOpenInterview={onOpenInterview}
          label={`${dim.label} rating per interview for ${roleTitle}, oldest to newest`}
        />
      ) : n === 1 ? (
        <div className={styles.meter} aria-hidden="true">
          <span style={{ width: `${pctOf(dim.latest, RUBRIC_MAX)}%` }} />
        </div>
      ) : (
        <p className={styles.none}>Not rated yet.</p>
      )}
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
    <Section
      icon="sparkles"
      title={single ? "Feedback from this interview" : "Recurring feedback"}
      sub={
        single
          ? null
          : "What keeps coming up across your interviews. Each dot is one interview, oldest first."
      }
    >
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
            <ThemeList kind="strengths" title="Strengths" themes={data.strengths} data={data} />
            <ThemeList kind="weaknesses" title="To work on" themes={data.weaknesses} data={data} />
          </div>
        </>
      )}
    </Section>
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
  const headClass = `${styles.themeHead} ${kind === "strengths" ? styles.themeHeadGood : styles.themeHeadWeak}`;

  if (data.single) {
    return (
      <div className={styles.themeCol}>
        <h4 className={headClass}>
          <Icon name={icon} />
          {title}
        </h4>
        {themes.length === 0 ? (
          <p className={styles.none}>None noted.</p>
        ) : (
          <ul className={`${styles.plainList} stagger`}>
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
      <h4 className={headClass}>
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
        <ul className={`${styles.themes} stagger`}>
          {recurring.map((t) => (
            <li key={t.theme} className={styles.theme}>
              <span className={styles.themeText}>{t.theme}</span>
              <span className={styles.themeMeta}>
                <span className={styles.count}>
                  {t.count} of {data.interviewCount} interviews
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
