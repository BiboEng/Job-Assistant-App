import { useEffect, useRef } from "react";
import { Link, useLocation } from "react-router";
import PublicHeader from "../components/PublicHeader.jsx";
import SiteFooter from "../components/SiteFooter.jsx";
import VideoPlaceholder from "../components/VideoPlaceholder.jsx";
import Icon from "../components/Icon.jsx";
import { useAuth } from "../auth/AuthProvider.jsx";
import { PATHS } from "../routes.js";
import styles from "./LandingScreen.module.css";

/**
 * The public front door: hero → About → How It Works → Contact (footer).
 *
 * One scrolling page, four routes. "/", "/about", "/how-it-works" and "/contact"
 * all render this component; the path picks the section to scroll to. React
 * Router keeps the same element mounted across those four paths, so clicking a
 * nav link is a scroll, not a reload — and each section still has a URL that
 * can be bookmarked or shared.
 *
 * All copy here is placeholder, written to be edited. The tutorial videos are
 * wired through HOW_IT_WORKS below — set `src` or `embedUrl` per feature.
 */

const SECTION_BY_PATH = {
  [PATHS.about]: "about",
  [PATHS.howItWorks]: "how-it-works",
  [PATHS.contact]: "contact",
};

/*
 * Kept to one sentence each. People scan a landing page; three paragraphs side
 * by side get skipped wholesale, and the detail they contained is repeated in
 * the walkthroughs below anyway.
 */
const ABOUT_PILLARS = [
  {
    icon: "messageSquare",
    title: "Mock interview practice",
    body: "Answer questions written for a real job description, typed or out loud, and get them scored.",
  },
  {
    icon: "briefcase",
    title: "Job matching",
    body: "Real openings in your city, ranked against your resume.",
  },
  {
    icon: "fileText",
    title: "Resume building",
    body: "Build an ATS-friendly resume with an assistant and download it as a PDF.",
  },
];

/*
 * One entry per core feature. To add a tutorial, set `video.src` (a file in
 * client/public/, e.g. "/videos/resume-builder.mp4") or `video.embedUrl`
 * (e.g. a YouTube embed URL). Leave both empty to keep the placeholder.
 */
const HOW_IT_WORKS = [
  {
    id: "resume-builder",
    icon: "fileText",
    title: "Resume Builder",
    summary:
      "Tell the assistant about your experience and it writes the sections — every line stays yours to edit.",
    steps: [
      "Describe a role, project or skill in the chat.",
      "Edit any line directly on the page.",
      "Download a print-ready, ATS-readable PDF.",
    ],
    video: { src: "", embedUrl: "", poster: "" },
  },
  {
    id: "job-finder",
    icon: "briefcase",
    title: "Job Finder",
    summary:
      "Your resume becomes the search. Every result comes back with a match score and the reason behind it.",
    steps: [
      "Upload your resume and pick a city.",
      "Get open roles scored against your background.",
      "Sort, filter, and apply from the listing.",
    ],
    video: { src: "", embedUrl: "", poster: "" },
  },
  {
    id: "mock-interview",
    icon: "messageSquare",
    title: "Mock Interview",
    summary:
      "Questions tailored to the job you paste, and feedback on both what you said and how you said it.",
    steps: [
      "Paste a job description, pick a focus.",
      "Answer by typing or on camera, against a timer.",
      "Get a scored report with strengths and weak spots.",
    ],
    video: { src: "", embedUrl: "", poster: "" },
  },
];

export default function LandingScreen() {
  const location = useLocation();
  const { user } = useAuth();
  const firstScrollRef = useRef(true);

  // Scroll to the section named by the path. Keyed on `location.key`, not the
  // pathname, so clicking "About" again after scrolling away still scrolls back.
  // The first run (a deep link or a refresh) jumps; later ones glide, unless the
  // user prefers reduced motion.
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

  const primaryCta = user
    ? { to: PATHS.dashboard, label: "Open your dashboard" }
    : { to: `${PATHS.signIn}?mode=sign-up`, label: "Create an account" };

  return (
    <div className="public-site">
      <PublicHeader />

      <main id="main-content" tabIndex={-1} className={`app-shell app-shell--public ${styles.page}`}>
        {/* --- hero -------------------------------------------------------- */}
        <section className={styles.hero} aria-labelledby="hero-heading">
          <div className={styles.heroCopy}>
            <p className="eyebrow">Interview prep, end to end</p>
            <h1 id="hero-heading" className={styles.title}>
              Walk into your next interview{" "}
              <span className={styles.grad}>already practised</span>
            </h1>
            <p className={styles.lede}>
              Practise on the job you actually want, find roles that fit, and build
              a resume that gets read.
            </p>
            <div className={styles.heroActions}>
              <Link to={primaryCta.to} className={`btn-primary ${styles.ctaLink}`}>
                {primaryCta.label}
                <Icon name="chevronRight" />
              </Link>
              <Link to={PATHS.howItWorks} className={`btn-ghost ${styles.ctaLink}`}>
                <Icon name="play" />
                See how it works
              </Link>
            </div>
          </div>

          <HeroPreview />
        </section>

        {/* --- about ------------------------------------------------------- */}
        <section id="about" className={styles.section} aria-labelledby="about-heading">
          <div className={styles.sectionHead}>
            <p className="eyebrow">About</p>
            <h2 id="about-heading" className={styles.sectionTitle} tabIndex={-1}>
              Everything between you and the offer
            </h2>
            <p className={styles.sectionLede}>
              The three things that decide whether you get hired — a resume that gets
              read, the right roles to apply for, and an interview you&apos;ve already
              rehearsed — in one place.
            </p>
          </div>

          <ul className={styles.pillars}>
            {ABOUT_PILLARS.map((p) => (
              <li key={p.title} className={styles.pillar}>
                <span className={styles.pillarIcon} aria-hidden="true">
                  <Icon name={p.icon} />
                </span>
                <h3 className={styles.pillarTitle}>{p.title}</h3>
                <p className={styles.pillarBody}>{p.body}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* --- how it works ------------------------------------------------ */}
        <section
          id="how-it-works"
          className={styles.section}
          aria-labelledby="how-heading"
        >
          <div className={styles.sectionHead}>
            <p className="eyebrow">How it works</p>
            <h2 id="how-heading" className={styles.sectionTitle} tabIndex={-1}>
              Three tools, one short walkthrough each
            </h2>
            <p className={styles.sectionLede}>
              Watch the tutorial, or skim the steps.
            </p>
          </div>

          <div className={styles.walkthroughs}>
            {HOW_IT_WORKS.map((f, i) => (
              <article
                key={f.id}
                id={f.id}
                className={`${styles.walkthrough} ${i % 2 === 1 ? styles.flipped : ""}`}
                aria-labelledby={`${f.id}-heading`}
              >
                <div className={styles.walkCopy}>
                  <span className={styles.walkIcon} aria-hidden="true">
                    <Icon name={f.icon} />
                  </span>
                  <h3 id={`${f.id}-heading`} className={styles.walkTitle}>
                    {f.title}
                  </h3>
                  <p className={styles.walkSummary}>{f.summary}</p>
                  <ol className={styles.steps}>
                    {f.steps.map((step, n) => (
                      <li key={n}>
                        <span className={styles.stepNum} aria-hidden="true">
                          {n + 1}
                        </span>
                        {step}
                      </li>
                    ))}
                  </ol>
                </div>

                <div className={styles.walkVideo}>
                  <VideoPlaceholder
                    label={`${f.title} tutorial`}
                    src={f.video.src}
                    embedUrl={f.video.embedUrl}
                    poster={f.video.poster}
                  />
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* --- closing call to action --------------------------------------- */}
        <section className={styles.closing} aria-labelledby="closing-heading">
          <h2 id="closing-heading" className={styles.closingTitle}>
            Ready for the real thing?
          </h2>
          <p className={styles.closingBody}>
            Your first practice interview takes about ten minutes.
          </p>
          <Link to={primaryCta.to} className={`btn-primary ${styles.ctaLink}`}>
            {user ? "Open your dashboard" : "Get started"}
            <Icon name="chevronRight" />
          </Link>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}

/**
 * Decorative product preview for the hero — a still of an interview question
 * and a scored answer, built from the app's own visual language. Purely
 * illustrative, so it's hidden from assistive tech.
 */
function HeroPreview() {
  return (
    <div className={styles.preview} aria-hidden="true">
      <div className={styles.previewBar}>
        <span className={styles.previewDot} />
        <span className={styles.previewDot} />
        <span className={styles.previewDot} />
        <span className={styles.previewStatus}>
          <Icon name="clock" />
          Question 2 of 4 · 2:14
        </span>
      </div>

      <div className={styles.previewBody}>
        <div className={styles.bubbleQ}>
          <span className={styles.bubbleRole}>Interviewer</span>
          Tell me about a time you had to ship under a tight deadline. What did you
          cut, and why?
        </div>
        <div className={styles.bubbleA}>
          <span className={styles.bubbleRole}>You</span>
          We had two weeks to launch checkout. I scoped out saved cards, kept guest
          checkout, and…
        </div>

        <div className={styles.previewScore}>
          <span className={styles.scoreChip}>8/10</span>
          <span className={styles.scoreText}>
            <strong>Strong answer.</strong> Clear trade-off — add the result in
            numbers.
          </span>
        </div>
      </div>
    </div>
  );
}
