import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import PublicHeader from "../components/PublicHeader.jsx";
import SiteFooter from "../components/SiteFooter.jsx";
import VideoPlaceholder from "../components/VideoPlaceholder.jsx";
import PlanComparison from "../components/PlanComparison.jsx";
import Icon from "../components/Icon.jsx";
import { useAuth } from "../auth/AuthProvider.jsx";
import { usePlanCatalog } from "../billing/usePlanCatalog.js";
import { planName } from "../billing/plans.js";
import { PATHS } from "../routes.js";
import styles from "./LandingScreen.module.css";

/**
 * The public front door: hero → at a glance → Features → Feedback → Pricing →
 * closing call to action → Contact (footer).
 *
 * One scrolling page, five routes. "/", "/about", "/how-it-works", "/pricing"
 * and "/contact" all render this component; the path picks the section to
 * scroll to. React Router keeps the same element mounted across them, so a nav
 * click is a scroll, not a reload, and each section still has a URL that can be
 * bookmarked. About and How It Works were one section's worth of content said
 * twice, so both paths now land on Features.
 *
 * The product images are real screenshots of the app (public/landing/*.webp),
 * taken with sample data. Retake them when the screens they show change.
 * Tutorial videos are wired through FEATURES below: set `video.src` or
 * `video.embedUrl` and it replaces that tab's screenshot.
 *
 * Copy rule for this page: short, plain, no em-dashes.
 */

const SECTION_BY_PATH = {
  [PATHS.about]: "features",
  [PATHS.howItWorks]: "features",
  [PATHS.pricing]: "pricing",
  [PATHS.contact]: "contact",
};

/*
 * The screenshots, each with a phone-width capture of the same screen: a whole
 * desktop screen shrunk to 360px is unreadable, so narrow viewports get the
 * app as it looks on a phone. Sizes are the files' real pixel dimensions
 * (captured at 2x), so the browser reserves the space before they load.
 */
const shot = (name, width, height, mobileWidth, mobileHeight, alt) => ({
  src: `/landing/${name}.webp`,
  width,
  height,
  mobile: { src: `/landing/m-${name}.webp`, width: mobileWidth, height: mobileHeight },
  alt,
});

const SHOTS = {
  hero: shot("hero-interview", 2560, 1360, 860, 1280,
    "A mock interview in progress: the interviewer's follow-up question, the candidate's earlier answer, a countdown timer and a half-typed reply."),
  interview: shot("feature-interview", 2080, 1400, 860, 1280,
    "The new interview screen with a pasted job description and options for question count and answer mode."),
  jobs: shot("feature-jobs", 2080, 1400, 860, 1280,
    "Job matches for a frontend engineer in Toronto, each with a match score and a one-line reason."),
  resume: shot("feature-resume", 2080, 1400, 860, 1280,
    "The resume builder: a chat with the assistant beside the live resume."),
  progress: shot("feature-progress", 2080, 1400, 860, 1280,
    "The progress page for a frontend engineer role, with scores rising from 58 to 78 over six interviews."),
  report: shot("feedback-report", 2068, 832, 680, 894,
    "A feedback report: overall score 78 out of 100, ratings for relevance, specificity, structure and depth, and lists of strengths and areas to work on."),
};

/** The facts under the hero. Every number is a real limit of the product. */
const STATS = [
  { value: "2-6", label: "questions, written from the posting you paste" },
  { value: "4", label: "answer-quality ratings on every interview" },
  { value: "19", label: "countries searched for open roles" },
  { value: "Free", label: "to start, no card needed" },
];

/*
 * One tab per tool. To add a tutorial, set `video.src` (a file in
 * client/public/, e.g. "/videos/resume-builder.mp4") or `video.embedUrl`
 * (e.g. a YouTube embed URL); it takes the screenshot's place. The `id`s are
 * the old How It Works anchors, so /how-it-works#job-finder still opens the
 * right tab.
 */
const FEATURES = [
  {
    id: "mock-interview",
    icon: "messageSquare",
    title: "Mock interviews",
    summary: "Paste a job description and answer questions written for that role, typed or out loud.",
    steps: [
      "Paste the posting and pick a focus",
      "Answer against a timer, typed or on camera",
      "Get a scored report with what to fix",
    ],
    image: SHOTS.interview,
    video: { src: "", embedUrl: "", poster: "" },
  },
  {
    id: "job-finder",
    icon: "briefcase",
    title: "Job matches",
    summary: "Upload your resume and get open roles in your city, each scored against your background.",
    steps: [
      "Upload a PDF and pick a city",
      "See each role's match score and the reason",
      "Track the ones you like on a board",
    ],
    image: SHOTS.jobs,
    video: { src: "", embedUrl: "", poster: "" },
  },
  {
    id: "resume-builder",
    icon: "fileText",
    title: "Resume builder",
    summary: "Describe your experience in a chat and the resume updates beside it. Every line stays editable.",
    steps: [
      "Tell the assistant about a role or project",
      "Edit any line directly on the page",
      "Download a PDF that applicant systems can read",
    ],
    image: SHOTS.resume,
    video: { src: "", embedUrl: "", poster: "" },
  },
  {
    id: "progress",
    icon: "trendingUp",
    title: "Progress",
    summary: "Interviews are grouped by role, so you can watch your scores move as you practise.",
    steps: [
      "A score trend for each role",
      "Four answer-quality ratings over time",
      "The feedback that keeps coming up",
    ],
    image: SHOTS.progress,
    video: { src: "", embedUrl: "", poster: "" },
  },
];

const FEEDBACK_NOTES = [
  {
    icon: "gauge",
    title: "A score and a summary",
    body: "An overall score out of 100, with a plain account of what worked and what didn't.",
  },
  {
    icon: "target",
    title: "Four ratings to work on",
    body: "Relevance, specificity, structure and depth, each out of 10, so you know which habit to fix first.",
  },
  {
    icon: "mic",
    title: "Delivery, when you speak",
    body: "In speak mode your pace, pauses and eye contact are measured in the browser and covered in the feedback.",
  },
];

export default function LandingScreen() {
  const location = useLocation();
  const { user } = useAuth();
  const firstScrollRef = useRef(true);

  // Scroll to the section named by the path. Keyed on `location.key`, not the
  // pathname, so clicking "Features" again after scrolling away still scrolls
  // back. The first run (a deep link or a refresh) jumps; later ones glide,
  // unless the user prefers reduced motion.
  useEffect(() => {
    const instant =
      firstScrollRef.current ||
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    firstScrollRef.current = false;
    const behavior = instant ? "auto" : "smooth";

    const id = SECTION_BY_PATH[location.pathname];
    if (!id) {
      window.scrollTo({ top: 0, behavior });
      return;
    }
    const section = document.getElementById(id);
    if (!section) return;
    section.scrollIntoView({ behavior, block: "start" });
    // Move focus with the view so keyboard and screen-reader users land in the
    // section they asked for, not back at the top of the nav.
    const heading = section.querySelector("h2");
    heading?.focus({ preventScroll: true });
  }, [location.key, location.pathname]);

  // Below-the-fold blocks marked `data-reveal` rise in once, the first time
  // they scroll into view. The hidden starting state only applies once this
  // has run (`data-reveal-ready` on <main>), so without IntersectionObserver,
  // or before hydration, everything is simply visible.
  const mainRef = useRef(null);
  useEffect(() => {
    const main = mainRef.current;
    if (!main || typeof IntersectionObserver === "undefined") return undefined;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.setAttribute("data-revealed", "");
          io.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.05 }
    );
    main.querySelectorAll("[data-reveal]").forEach((el) => io.observe(el));
    main.setAttribute("data-reveal-ready", "");
    return () => io.disconnect();
  }, []);

  // One label per intent across the whole page: "Start free" for a visitor,
  // "Open dashboard" for someone already signed in.
  const primaryCta = user
    ? { to: PATHS.dashboard, label: "Open dashboard" }
    : { to: `${PATHS.signIn}?mode=sign-up`, label: "Start free" };

  // Pricing: prices come from Stripe via the server, so what's shown is what
  // Checkout charges. Paid cards lead to the Plans page's checkout
  // confirmation, through sign-up first for a visitor without an account.
  const catalog = usePlanCatalog();
  const [interval, setInterval_] = useState("month");

  function planAction(id, { price }) {
    if (id === "regular") {
      return (
        <Link to={primaryCta.to} className={`btn-ghost ${styles.ctaLink}`}>
          {primaryCta.label}
        </Link>
      );
    }
    if (!price) {
      return (
        <button type="button" className="btn-ghost" disabled>
          {catalog?.enabled ? "Not available right now" : "Coming soon"}
        </button>
      );
    }
    const target = `${PATHS.plans}?plan=${id}&interval=${interval}`;
    const className = `${id === "pro" ? "btn-primary" : "btn-ghost"} ${styles.ctaLink}`;
    return user ? (
      <Link to={target} className={className}>
        Choose {planName(id)}
        <Icon name="chevronRight" />
      </Link>
    ) : (
      <Link to={`${PATHS.signIn}?mode=sign-up`} state={{ from: target }} className={className}>
        Choose {planName(id)}
        <Icon name="chevronRight" />
      </Link>
    );
  }

  return (
    <div className="public-site">
      <PublicHeader />

      <main id="main-content" ref={mainRef} tabIndex={-1} className={styles.page}>
        {/* --- hero: the promise, then the product ----------------------- */}
        <section className={styles.hero} aria-labelledby="hero-heading">
          <div className={styles.inner}>
            <div className={styles.heroCopy}>
              <h1 id="hero-heading" className={styles.title}>
                Walk into your next interview{" "}
                <span className={styles.accentWord}>already practised</span>
              </h1>
              <p className={styles.heroLede}>
                Interview questions written from the job you want, scored on what you said
                and how you said it.
              </p>
              <div className={styles.heroActions}>
                <Link to={primaryCta.to} className={`btn-primary btn-lg ${styles.ctaLink}`}>
                  {primaryCta.label}
                  <Icon name="chevronRight" />
                </Link>
                <Link to={PATHS.howItWorks} className={`btn-ghost btn-lg ${styles.ctaLink}`}>
                  See how it works
                </Link>
              </div>
            </div>

            <Shot image={SHOTS.hero} className={styles.heroShot} priority />
          </div>
        </section>

        {/* --- at a glance --------------------------------------------------- */}
        <section className={styles.proof} aria-label="At a glance">
          <ul className={`${styles.inner} ${styles.stats}`}>
            {STATS.map((s) => (
              <li key={s.label} className={styles.stat}>
                <span className={`mono ${styles.statValue}`}>{s.value}</span>
                <span className={styles.statLabel}>{s.label}</span>
              </li>
            ))}
          </ul>
        </section>

        {/* --- features: one tab per tool --------------------------------- */}
        <section id="features" className={styles.band} aria-labelledby="features-heading">
          <div className={styles.inner}>
            <div className={styles.sectionHead} data-reveal="">
              <h2 id="features-heading" className={styles.sectionTitle} tabIndex={-1}>
                Everything you need before the interview
              </h2>
              <p className={styles.sectionLede}>
                Practise for a specific job, find roles that fit your resume, write the
                resume itself, and watch your scores climb.
              </p>
            </div>
            <div data-reveal="">
              <FeatureTabs features={FEATURES} />
            </div>
          </div>
        </section>

        {/* --- feedback: what you get at the end --------------------------- */}
        <section
          id="feedback"
          className={`${styles.band} ${styles.bandRaised}`}
          aria-labelledby="feedback-heading"
        >
          <div className={styles.inner}>
            <div className={styles.sectionHead} data-reveal="">
              <h2 id="feedback-heading" className={styles.sectionTitle} tabIndex={-1}>
                Feedback you can act on
              </h2>
              <p className={styles.sectionLede}>
                Every interview ends with a report that says what to change, answer by
                answer.
              </p>
            </div>

            <div data-reveal="">
              <Shot image={SHOTS.report} className={styles.reportShot} />
            </div>

            <ul className={styles.notes}>
              {FEEDBACK_NOTES.map((n, i) => (
                <li
                  key={n.title}
                  className={styles.note}
                  data-reveal=""
                  style={{ "--reveal-delay": `${i * 80}ms` }}
                >
                  <span className={styles.noteIcon} aria-hidden="true">
                    <Icon name={n.icon} />
                  </span>
                  <h3 className={styles.noteTitle}>{n.title}</h3>
                  <p className={styles.noteBody}>{n.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* --- pricing ------------------------------------------------------- */}
        <section id="pricing" className={styles.band} aria-labelledby="pricing-heading">
          <div className={styles.inner}>
            <div className={styles.sectionHead} data-reveal="">
              <h2 id="pricing-heading" className={styles.sectionTitle} tabIndex={-1}>
                Free to start. Upgrade when it counts.
              </h2>
              <p className={styles.sectionLede}>
                Every tool works on the free plan. Paid plans add more practice a day,
                speaking on camera and deeper progress tracking.
              </p>
            </div>
            <div data-reveal="">
              <PlanComparison
                catalog={catalog}
                interval={interval}
                onIntervalChange={setInterval_}
                renderAction={planAction}
                collapseTable
              />
            </div>
            <p className={styles.pricingLegal}>
              Paid plans renew automatically until cancelled, and you can cancel any time.
              New subscriptions can be refunded within 14 days. See the{" "}
              <Link to={PATHS.terms}>Terms of Service</Link> and the{" "}
              <Link to={PATHS.refunds}>Refund &amp; Cancellation Policy</Link>.
            </p>
          </div>
        </section>

        {/* --- closing call to action ---------------------------------------- */}
        <section className={styles.closing} aria-labelledby="closing-heading">
          <div className={`${styles.inner} ${styles.closingInner}`} data-reveal="">
            <div>
              <h2 id="closing-heading" className={styles.closingTitle}>
                Ready for the real thing?
              </h2>
              <p className={styles.closingBody}>
                Your first practice interview takes about ten minutes.
              </p>
            </div>
            <Link to={primaryCta.to} className={`btn-primary btn-lg ${styles.ctaLink}`}>
              {primaryCta.label}
              <Icon name="chevronRight" />
            </Link>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}

/**
 * The four tools as an ARIA tab set: a list of tabs on the left (a 2×2 grid
 * on narrow screens) and the selected tool's screenshot, or tutorial video,
 * with its three steps. Arrow keys, Home and End move between tabs, and
 * selection follows focus.
 *
 * Each tab carries its one-line summary on wide screens. On narrow ones the
 * tabs shrink to their titles and the summary shows in the panel instead; CSS
 * hides whichever copy isn't in use, so it's only ever read once.
 */
function FeatureTabs({ features }) {
  const location = useLocation();
  const [active, setActive] = useState(() => {
    const fromHash = features.findIndex((f) => `#${f.id}` === location.hash);
    return fromHash === -1 ? 0 : fromHash;
  });
  const tabRefs = useRef([]);

  function onKeyDown(e) {
    const last = features.length - 1;
    const next = {
      ArrowDown: active === last ? 0 : active + 1,
      ArrowRight: active === last ? 0 : active + 1,
      ArrowUp: active === 0 ? last : active - 1,
      ArrowLeft: active === 0 ? last : active - 1,
      Home: 0,
      End: last,
    }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    setActive(next);
    tabRefs.current[next]?.focus();
  }

  return (
    <div className={styles.features}>
      <div role="tablist" aria-label="Tools" className={styles.tabList} onKeyDown={onKeyDown}>
        {features.map((f, i) => {
          const selected = i === active;
          return (
            <button
              key={f.id}
              ref={(el) => (tabRefs.current[i] = el)}
              type="button"
              role="tab"
              id={`tab-${f.id}`}
              aria-selected={selected}
              aria-controls={`panel-${f.id}`}
              tabIndex={selected ? 0 : -1}
              className={`${styles.tab} ${selected ? styles.tabActive : ""}`}
              onClick={() => setActive(i)}
            >
              <span className={styles.tabIcon} aria-hidden="true">
                <Icon name={f.icon} />
              </span>
              <span className={styles.tabText}>
                <span className={styles.tabTitle}>{f.title}</span>
                <span className={styles.tabSummary}>{f.summary}</span>
              </span>
            </button>
          );
        })}
      </div>

      {features.map((f, i) => (
        <div
          key={f.id}
          role="tabpanel"
          id={`panel-${f.id}`}
          aria-labelledby={`tab-${f.id}`}
          hidden={i !== active}
          className={styles.tabPanel}
        >
          <p className={styles.panelSummary}>{f.summary}</p>
          {f.video.src || f.video.embedUrl ? (
            <VideoPlaceholder
              label={`${f.title} tutorial`}
              src={f.video.src}
              embedUrl={f.video.embedUrl}
              poster={f.video.poster}
            />
          ) : (
            <Shot image={f.image} />
          )}
          <ul className={styles.steps}>
            {f.steps.map((step) => (
              <li key={step}>
                <Icon name="check" />
                <span>{step}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** One screenshot in the page's frame, with its phone-width source. */
function Shot({ image, className = "", priority = false }) {
  return (
    <figure className={`${styles.shot} ${className}`}>
      <picture>
        <source
          media="(max-width: 680px)"
          srcSet={image.mobile.src}
          width={image.mobile.width}
          height={image.mobile.height}
        />
        <img
          src={image.src}
          width={image.width}
          height={image.height}
          alt={image.alt}
          decoding="async"
          {...(priority ? { fetchPriority: "high" } : { loading: "lazy" })}
        />
      </picture>
    </figure>
  );
}
