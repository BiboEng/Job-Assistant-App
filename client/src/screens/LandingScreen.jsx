import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import PublicHeader from "../components/PublicHeader.jsx";
import SiteFooter from "../components/SiteFooter.jsx";
import PlanComparison from "../components/PlanComparison.jsx";
import Icon from "../components/Icon.jsx";
import KineticText from "../components/KineticText.jsx";
import SplitFlap from "../components/SplitFlap.jsx";
import { useAuth } from "../auth/AuthProvider.jsx";
import { usePlanCatalog } from "../billing/usePlanCatalog.js";
import { planName } from "../billing/plans.js";
import { PATHS } from "../routes.js";
import {
  BOARD_IDLE,
  BOARD_INTRO,
  BOARD_WIDTH,
  MASCOT_CLICKS,
  SAMPLE_ROLES,
} from "./landingSamples.js";
import styles from "./LandingScreen.module.css";

/**
 * The public front door, told as one practice session with the Jobuddy
 * mascot as the interviewer: hero (he says hello) → how a session goes (he
 * asks, follows up, gives feedback) → the other tools → Pricing → closing
 * (he celebrates) → Contact (footer).
 *
 * One scrolling page, five routes. "/", "/about", "/how-it-works", "/pricing"
 * and "/contact" all render this component; the path picks the section to
 * scroll to. React Router keeps the same element mounted across them, so a nav
 * click is a scroll, not a reload, and each section still has a URL.
 *
 * Headings rise in word by word (KineticText), and a split-flap board in the
 * hero turns through a few roles and lands on "YOUR NEXT JOB" (SplitFlap),
 * then keeps turning to a new role every few seconds until a visitor picks
 * one. Only the hero idles: the mascot floats, and his orbit (a dashed ring
 * with five icon tiles riding it) turns slowly. Those loops pause when the
 * hero is off-screen, and reduced motion stops them.
 *
 * Depth, on wide screens: the hero's layers move at different speeds as it
 * scrolls away and shift a few pixels with the mouse (parallax), "How it
 * works" is one pinned stage that changes as its three steps scroll past, and
 * the sample report tilts flat as it arrives. Scroll effects use CSS
 * scroll-driven animation, so a browser without it gets the static page.
 *
 * The page is a run of sections in different tones (data-surface: pine,
 * slate, then a mint closing section), set up in tokens.css.
 *
 * The hero is interactive. "Try a sample question" buttons flip the board to
 * a role and have the mascot ask a sample question for it (landingSamples.js:
 * plain data, no model call). The mascot gives a thumbs-up while "Start free"
 * is hovered or focused, and pressing him steps through his expressions.
 *
 * The mascot art is public/landing/mascot/*.webp, trimmed and resized from
 * the PNGs in the mascot kit. The one product image is a real screenshot of a
 * feedback report (public/landing/feedback-report.webp), taken with sample
 * data. Retake it if the report changes visibly.
 *
 * Copy rule for this page: short, plain, no em-dashes.
 */

const SECTION_BY_PATH = {
  [PATHS.about]: "how-it-works",
  [PATHS.howItWorks]: "how-it-works",
  [PATHS.pricing]: "pricing",
  [PATHS.contact]: "contact",
};

/** The mascot's poses, with each file's real pixel size so nothing shifts on load. */
const POSES = {
  welcome: { src: "/landing/mascot/welcome.webp", width: 880, height: 857 },
  interviewing: { src: "/landing/mascot/interviewing.webp", width: 560, height: 576 },
  thinking: { src: "/landing/mascot/thinking.webp", width: 560, height: 683 },
  feedback: { src: "/landing/mascot/feedback.webp", width: 560, height: 524 },
  celebrate: { src: "/landing/mascot/celebrate.webp", width: 560, height: 573 },
  positive: { src: "/landing/mascot/positive.webp", width: 560, height: 576 },
};

/** Every pose the hero mascot can take. All but "welcome" load after the page. */
const HERO_POSES = ["welcome", "interviewing", "positive", "thinking", "feedback", "celebrate"];

const REPORT = {
  src: "/landing/feedback-report.webp",
  width: 2068,
  height: 832,
  mobile: { src: "/landing/m-feedback-report.webp", width: 680, height: 894 },
  alt: "A feedback report: overall score 78 out of 100, ratings for relevance, specificity, structure and depth, and lists of strengths and areas to work on.",
};

const HELLO = "Hi, I'm Jobuddy. Paste a job posting and I'll interview you for it.";

/** The icon tiles riding the hero mascot's orbit: what a session involves. */
const ORBIT = ["mic", "messageSquare", "sparkles", "target", "trendingUp"];

/** How long the hero's board rests on a line before turning to the next. */
const BOARD_IDLE_MS = 4500;

const pad2 = (n) => String(n).padStart(2, "0");

/*
 * The session, one beat per step. `say` is what the mascot says in that
 * step: lines in the voice of a real session (the questions match the sample
 * report further down), not claims about the product.
 */
const SESSION = [
  {
    pose: "interviewing",
    title: "Paste the job you want",
    body: "Pick 2 to 6 questions and a focus. Every question is written from that posting, so you practise for the role in front of you.",
    say: "The posting mentions a legacy checkout. Tell me about a migration you led.",
  },
  {
    pose: "thinking",
    title: "Answer like it's the real thing",
    body: "Type your answers, or say them out loud on camera, with a timer running. Follow-up questions build on what you just said.",
    say: "Good. Now walk me through your first hour after a bad release.",
  },
  {
    pose: "feedback",
    title: "Find out what to fix",
    body: "Every interview ends with a score out of 100, four ratings to work on, and notes for each answer.",
    say: "Strong story. Next time, give the result in numbers.",
  },
];

/**
 * Everything else in the app, one line each. `motion` is how the icon moves
 * when its item is hovered (LandingScreen.module.css, [data-motion]).
 */
const TOOLS = [
  {
    icon: "briefcase",
    motion: "lift",
    title: "Job matches",
    body: "Upload your resume and get open roles in your city, each scored against it.",
  },
  {
    icon: "fileText",
    motion: "tilt",
    title: "Resume builder",
    body: "Describe your experience in a chat and an ATS-friendly resume fills in beside it.",
  },
  {
    icon: "trendingUp",
    motion: "rise",
    title: "Progress",
    body: "Scores for each role over time, and the feedback that keeps coming up.",
  },
  {
    icon: "kanban",
    motion: "slide",
    title: "Applications",
    body: "A board for every role you're chasing, from saved to accepted.",
  },
];

export default function LandingScreen() {
  const location = useLocation();
  const { user } = useAuth();
  const firstScrollRef = useRef(true);

  // Scroll to the section named by the path. Keyed on `location.key`, not the
  // pathname, so clicking a nav link again after scrolling away still scrolls
  // back. The first run (a deep link or a refresh) jumps; later ones glide,
  // unless the user prefers reduced motion.
  useEffect(() => {
    const instant = firstScrollRef.current || prefersReducedMotion();
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

  // --- the interactive hero ---------------------------------------------
  // What the mascot shows comes from three things, strongest first: "Start
  // free" hovered or focused (thumbs-up), a click step (MASCOT_CLICKS), and
  // otherwise the base: asking the picked role's sample question, or waving.
  const [pick, setPick] = useState(null); // { id, q } once a role is chosen
  const [clickStep, setClickStep] = useState(0); // 0 = none
  const [ctaHover, setCtaHover] = useState(false);
  const heroArtRef = useRef(null);
  // Half a turn of the refresh icon per "Another question" (it only ever adds,
  // so the icon keeps turning the same way).
  const [spins, setSpins] = useState(0);
  // The closing mascot hops again when hovered or tapped (once per hop).
  const [hopping, setHopping] = useState(false);

  // While the hero is off-screen its idle loops pause (data-paused, read by
  // the CSS) and the board stops turning. Written to the DOM directly: it
  // changes nothing React renders.
  const heroRef = useRef(null);
  const heroVisibleRef = useRef(true);
  useEffect(() => {
    const hero = heroRef.current;
    if (!hero || typeof IntersectionObserver === "undefined") return undefined;
    const io = new IntersectionObserver(([entry]) => {
      heroVisibleRef.current = entry.isIntersecting;
      hero.toggleAttribute("data-paused", !entry.isIntersecting);
    });
    io.observe(hero);
    return () => io.disconnect();
  }, []);

  // The board keeps turning after its intro: each time it comes to rest it
  // asks for the next line, BOARD_IDLE_MS later. A picked role stops it for
  // good (the board then shows that role), and it waits while the hero is
  // off-screen or the tab is hidden. Reduced motion: it stays put.
  const [idleBoard, setIdleBoard] = useState(null);
  const idleRef = useRef({ timer: 0, next: 0, stopped: false });
  useEffect(() => () => window.clearTimeout(idleRef.current.timer), []);
  function onBoardSettle() {
    const idle = idleRef.current;
    if (idle.stopped || prefersReducedMotion()) return;
    window.clearTimeout(idle.timer);
    const tick = () => {
      if (idle.stopped) return;
      if (document.hidden || !heroVisibleRef.current) {
        idle.timer = window.setTimeout(tick, 1000);
        return;
      }
      const line = BOARD_IDLE[idle.next];
      idle.next = (idle.next + 1) % BOARD_IDLE.length;
      setIdleBoard(line);
    };
    idle.timer = window.setTimeout(tick, BOARD_IDLE_MS);
  }

  // Pointer parallax: the mouse's place over the hero, -1 to 1 per axis,
  // written to the art as --pointer-x/-y once a frame. The CSS moves the
  // layers by it (wide screens with a mouse only); touch is ignored.
  const pointerRef = useRef({ frame: 0, x: 0, y: 0 });
  function writePointer() {
    const p = pointerRef.current;
    p.frame = 0;
    const art = heroArtRef.current;
    if (!art) return;
    art.style.setProperty("--pointer-x", p.x.toFixed(3));
    art.style.setProperty("--pointer-y", p.y.toFixed(3));
  }
  function onHeroPointerMove(e) {
    if (e.pointerType !== "mouse" || prefersReducedMotion()) return;
    const r = heroRef.current.getBoundingClientRect();
    const p = pointerRef.current;
    p.x = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1));
    p.y = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height) * 2 - 1));
    if (!p.frame) p.frame = window.requestAnimationFrame(writePointer);
  }
  function onHeroPointerLeave() {
    const p = pointerRef.current;
    p.x = 0;
    p.y = 0;
    if (!p.frame) p.frame = window.requestAnimationFrame(writePointer);
  }
  useEffect(() => () => window.cancelAnimationFrame(pointerRef.current.frame), []);

  // "How it works": which step is in the middle of the screen. On wide
  // screens the pinned stage shows that step's pose and line, and the other
  // steps dim; on a phone each step has its own stage and this is unused.
  const [activeStep, setActiveStep] = useState(0);
  const stepRefs = useRef([]);
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return undefined;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActiveStep(Number(entry.target.dataset.step));
        }
      },
      { rootMargin: "-45% 0px -45% 0px" }
    );
    stepRefs.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, []);

  const role = pick ? SAMPLE_ROLES.find((r) => r.id === pick.id) : null;
  const clicked = clickStep ? MASCOT_CLICKS[clickStep - 1] : null;
  const base = role
    ? { pose: "interviewing", line: role.questions[pick.q] }
    : { pose: "welcome", line: HELLO };
  const heroLine = clicked ? clicked.line : base.line;
  const heroPose = ctaHover ? "positive" : clicked ? clicked.pose : base.pose;

  // On a phone the mascot sits under the buttons; bring his answer into view.
  function revealBubble() {
    const el = heroArtRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.top >= 0 && r.bottom <= window.innerHeight) return;
    el.scrollIntoView({ block: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }

  function pickRole(id) {
    idleRef.current.stopped = true;
    window.clearTimeout(idleRef.current.timer);
    setClickStep(0);
    setPick((p) => (p?.id === id ? p : { id, q: 0 }));
    revealBubble();
  }

  function anotherQuestion() {
    setSpins((n) => n + 1);
    setClickStep(0);
    setPick((p) => p && { ...p, q: (p.q + 1) % role.questions.length });
    revealBubble();
  }

  // The press after the last step goes back to the base pose.
  function poke() {
    setClickStep((s) => (s + 1) % (MASCOT_CLICKS.length + 1));
  }

  const ctaHoverProps = {
    onPointerEnter: () => setCtaHover(true),
    onPointerLeave: () => setCtaHover(false),
    onFocus: () => setCtaHover(true),
    onBlur: () => setCtaHover(false),
  };

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

  // The mascot peeks over a plan card's top edge: the Ultimate card on wide
  // screens (the space above it is clear), the first card once they stack.
  function planPeek(id) {
    if (id === "ultimate") return <Peek pose="positive" className={styles.peekPlanWide} />;
    if (id === "regular") return <Peek pose="positive" className={styles.peekPlanStacked} />;
    return null;
  }

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
        {/* --- hero: the mascot says hello ------------------------------------ */}
        <section
          ref={heroRef}
          className={styles.hero}
          aria-labelledby="hero-heading"
          onPointerMove={onHeroPointerMove}
          onPointerLeave={onHeroPointerLeave}
        >
          <div className={`${styles.inner} ${styles.heroInner}`}>
            <div className={styles.heroCopy}>
              <KineticText
                as="h1"
                id="hero-heading"
                trigger="load"
                className={styles.title}
                accentClassName={styles.accentWord}
                parts={["Practise with a buddy who's", { text: "read the job posting", accent: true }]}
              />
              <p className={styles.heroLede}>
                Jobuddy interviews you for the exact role you want, then tells you what to
                fix before the real one.
              </p>
              <div className={styles.heroActions}>
                <Link
                  to={primaryCta.to}
                  className={`btn-primary btn-lg ${styles.ctaLink}`}
                  {...ctaHoverProps}
                >
                  {primaryCta.label}
                  <Icon name="chevronRight" />
                </Link>
                {!user && <span className={styles.heroNote}>Free plan. No card needed.</span>}
              </div>
              <div className={styles.departures}>
                <span className={`mono ${styles.departuresLabel}`} aria-hidden="true">
                  Now interviewing
                </span>
                <SplitFlap
                  sequence={BOARD_INTRO}
                  value={role?.board ?? idleBoard}
                  width={BOARD_WIDTH}
                  hold={1000}
                  delay={900}
                  settleAccent
                  onSettle={onBoardSettle}
                />
                <span className="sr-only">
                  Practise for any role, from engineering to nursing.
                </span>
              </div>

              <div className={styles.try} role="group" aria-labelledby="try-label">
                <span id="try-label" className={styles.tryLabel}>
                  Try a sample question:
                </span>
                <div className={styles.tryRoles}>
                  {SAMPLE_ROLES.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      className={`btn-ghost btn-sm ${styles.chip}`}
                      aria-pressed={role?.id === r.id}
                      onClick={() => pickRole(r.id)}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
                {role && (
                  <p className={styles.tryNote}>
                    <button
                      type="button"
                      className={`link-btn ${styles.another}`}
                      onClick={anotherQuestion}
                    >
                      <span
                        className={styles.anotherIcon}
                        style={{ transform: `rotate(${spins * 180}deg)` }}
                      >
                        <Icon name="refresh" />
                      </span>
                      Another question
                    </button>
                    <span>
                      Samples only. Paste a real posting after you sign up and yours are
                      written for it.
                    </span>
                  </p>
                )}
              </div>
            </div>

            {/* Two layers, for parallax: the halo and orbit behind (they move
                least), the bubble and mascot in front (they move together, so
                the bubble's tail stays on him). */}
            <div className={styles.heroArt} ref={heroArtRef}>
              <div className={styles.heroDepth} aria-hidden="true">
                <span className={styles.halo} />
                <Orbit />
              </div>
              <div className={styles.heroFront}>
                <Bubble className={styles.heroBubble} text={heroLine} typed live />
                <span className={styles.buddyFloat}>
                  <HeroBuddy pose={heroPose} onPoke={poke} />
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* --- how a session goes: three beats -------------------------------- */}
        <section
          id="how-it-works"
          className={styles.band}
          data-surface="pine"
          aria-labelledby="how-heading"
        >
          <div className={styles.inner}>
            <div className={styles.sectionHead}>
              <KineticText
                id="how-heading"
                className={styles.sectionTitle}
                tabIndex={-1}
                parts={["How a practice interview goes"]}
              />
              <p className={styles.sectionLede} data-reveal="" style={{ "--reveal-delay": "200ms" }}>
                About ten minutes, start to finish. Here&apos;s what happens.
              </p>
            </div>

            {/* Wide screens: the steps scroll past on the left while one stage
                stays pinned on the right and follows them. Phones: each step
                has its own stage under it (the .stage in each item). Either
                way the stages are decoration; what the mascot says is in each
                step's copy for screen readers. */}
            <div className={styles.story}>
              <ol className={styles.beats}>
                {SESSION.map((beat, i) => (
                  <li
                    key={beat.pose}
                    ref={(el) => {
                      stepRefs.current[i] = el;
                    }}
                    data-step={i}
                    data-active={activeStep === i ? "" : undefined}
                    className={styles.beat}
                  >
                    <span className={styles.numeral} aria-hidden="true">
                      {pad2(i + 1)}
                    </span>
                    <div className={styles.beatCopy} data-reveal="">
                      <SplitFlap
                        sequence={[pad2(i + 1)]}
                        size="sm"
                        accent
                        delay={150}
                        className={styles.beatStep}
                      />
                      <span className="sr-only">Step {i + 1}.</span>
                      <h3 className={styles.beatTitle}>{beat.title}</h3>
                      <p className={styles.beatBody}>{beat.body}</p>
                      <p className="sr-only">Jobuddy says: {beat.say}</p>
                    </div>
                    <div className={styles.stage} data-reveal="" aria-hidden="true">
                      <Bubble className={styles.stageBubble} text={beat.say} />
                      <Mascot pose={beat.pose} className={styles.stageMascot} />
                    </div>
                  </li>
                ))}
              </ol>

              <div className={styles.pinned} aria-hidden="true">
                <StoryStage active={activeStep} />
              </div>
            </div>

            {/* The stage hands over to the report: the mascot, holding his
                chart, peeks over its top edge. */}
            <figure className={styles.report} data-reveal="">
              <div className={styles.reportFrame}>
                <Peek pose="feedback" className={styles.peekReport} />
                <picture>
                  <source
                    media="(max-width: 680px)"
                    srcSet={REPORT.mobile.src}
                    width={REPORT.mobile.width}
                    height={REPORT.mobile.height}
                  />
                  <img
                    src={REPORT.src}
                    width={REPORT.width}
                    height={REPORT.height}
                    alt={REPORT.alt}
                    loading="lazy"
                    decoding="async"
                  />
                </picture>
              </div>
              <figcaption className={styles.reportCaption}>
                The top of a real feedback report, from a sample interview.
              </figcaption>
            </figure>
          </div>
        </section>

        {/* --- the other tools: one strip ------------------------------------- */}
        <section className={styles.tools} data-surface="slate" aria-labelledby="tools-heading">
          <div className={styles.inner}>
            <KineticText
              id="tools-heading"
              className={styles.toolsTitle}
              parts={["More than mock interviews"]}
            />
            <ul className={styles.toolList}>
              {TOOLS.map((t, i) => (
                <li
                  key={t.title}
                  className={styles.tool}
                  data-motion={t.motion}
                  data-reveal=""
                  style={{ "--reveal-delay": `${i * 70}ms` }}
                >
                  <span className={styles.toolIcon} aria-hidden="true">
                    <Icon name={t.icon} />
                  </span>
                  <h3 className={styles.toolName}>{t.title}</h3>
                  <p className={styles.toolBody}>{t.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* --- pricing: the three cards, nothing else ------------------------- */}
        <section id="pricing" className={styles.band} aria-labelledby="pricing-heading">
          <div className={styles.inner}>
            <div className={styles.sectionHead}>
              <KineticText
                id="pricing-heading"
                className={styles.sectionTitle}
                tabIndex={-1}
                parts={["Free to start. Upgrade when it counts."]}
              />
              <p className={styles.sectionLede} data-reveal="" style={{ "--reveal-delay": "200ms" }}>
                Every tool works on the free plan. Paid plans add more practice a day,
                speaking on camera and deeper progress tracking.
              </p>
            </div>
            <div className={styles.pricingCards} data-reveal="">
              <PlanComparison
                catalog={catalog}
                interval={interval}
                onIntervalChange={setInterval_}
                renderAction={planAction}
                renderPeek={planPeek}
                showTable={false}
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

        {/* --- closing: the mascot celebrates --------------------------------- */}
        {/* The one mint section: the accent as the whole background, ink
            type, an ink button (data-surface="mint" in tokens.css). The
            mascot stands on an ink disc, because his own mint trim would
            vanish against the background. */}
        <section className={styles.closing} data-surface="mint" aria-labelledby="closing-heading">
          <div className={`${styles.inner} ${styles.closingInner}`} data-reveal="">
            <span className={styles.closingMascotWrap}>
              <span className={styles.closingDisc} aria-hidden="true" />
              <span
                className={`${styles.closingHopper} ${hopping ? styles.hopAgain : ""}`}
                onPointerEnter={(e) => e.pointerType === "mouse" && setHopping(true)}
                onClick={() => setHopping(true)}
                onAnimationEnd={(e) => {
                  if (e.animationName.includes("hopAgain")) setHopping(false);
                }}
              >
                <Mascot pose="celebrate" className={styles.closingMascot} />
              </span>
            </span>
            <KineticText
              id="closing-heading"
              className={styles.closingTitle}
              startDelay={200}
              parts={["Your next interview", { text: "starts here", accent: true }]}
              accentClassName={styles.closingAccent}
            />
            <p className={styles.closingBody}>Run your first practice now. It&apos;s free.</p>
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

function prefersReducedMotion() {
  return Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

/** One pose of the mascot, as decoration (the words around it carry the meaning). */
function Mascot({ pose, className = "" }) {
  const art = POSES[pose];
  return (
    <img
      src={art.src}
      width={art.width}
      height={art.height}
      alt=""
      className={`${styles.mascot} ${className}`}
      decoding="async"
      loading="lazy"
    />
  );
}

/**
 * The mascot peeking over the top edge of whatever he's placed on (a card,
 * the report), as if standing behind it: a box sitting on that edge clips
 * him at it. He rises into view the first time the surrounding block is
 * revealed. Decorative. Placement and size come from `className`.
 */
function Peek({ pose, className = "" }) {
  const art = POSES[pose];
  return (
    <span className={`${styles.peek} ${className}`} aria-hidden="true">
      <img
        src={art.src}
        width={art.width}
        height={art.height}
        alt=""
        className={styles.peekImg}
        draggable="false"
        decoding="async"
        loading="lazy"
      />
    </span>
  );
}

/**
 * The hero mascot's orbit: a dashed ring that turns slowly, with an icon tile
 * riding it at each of five evenly spaced points. Each tile turns back the
 * other way at the same rate, so it stays upright as it goes round. The
 * first tile starts a little past the top, clear of the speech bubble.
 */
function Orbit() {
  return (
    <span className={styles.orbit}>
      {ORBIT.map((icon, i) => {
        const angle = (i / ORBIT.length) * 2 * Math.PI - Math.PI / 2 + 0.5;
        return (
          <span
            key={icon}
            className={styles.orbitItem}
            style={{
              left: `${50 + 50 * Math.cos(angle)}%`,
              top: `${50 + 50 * Math.sin(angle)}%`,
              "--reveal-delay": `${900 + i * 90}ms`,
            }}
          >
            <span className={styles.orbitTile}>
              <Icon name={icon} />
            </span>
          </span>
        );
      })}
    </span>
  );
}

/**
 * The pinned stage of "How it works" (wide screens): the step counter turning
 * on a small split-flap board, the step's line typed in the bubble, and the
 * mascot's poses stacked like the hero's, the active one fading in with a hop.
 */
function StoryStage({ active }) {
  return (
    <div className={styles.pinnedStage}>
      <div className={styles.pinnedHead}>
        <SplitFlap sequence={["01"]} value={pad2(active + 1)} size="sm" accent delay={150} />
        <span className={`mono ${styles.pinnedOf}`}>of {pad2(SESSION.length)}</span>
      </div>
      <Bubble className={styles.pinnedBubble} text={SESSION[active].say} typed />
      <div className={styles.pinnedBuddy}>
        {SESSION.map((beat, i) => {
          const art = POSES[beat.pose];
          return (
            <img
              key={beat.pose}
              src={art.src}
              width={art.width}
              height={art.height}
              alt=""
              draggable="false"
              decoding="async"
              loading="lazy"
              className={`${styles.pinnedPose} ${i === active ? styles.pinnedPoseOn : ""}`}
            />
          );
        })}
      </div>
    </div>
  );
}

/**
 * The mascot's speech bubble. With `typed`, the line types itself out:
 * shortly after the page loads, and again whenever the line changes. The
 * full line is laid out invisibly underneath so the bubble is its final size
 * from the start, and screen readers get the whole line at once rather than
 * a character at a time; with `live` they're told when it changes (the hero,
 * where a visitor's click changes it). Reduced motion shows it whole.
 */
function Bubble({ text, typed = false, live = false, className = "" }) {
  const shown = useTypewriter(text, typed);
  return (
    <p className={`${styles.bubble} ${className}`} aria-live={live ? "polite" : undefined}>
      {typed ? (
        <>
          <span className="sr-only">{text}</span>
          <span className={styles.bubbleSizer} aria-hidden="true">
            {text}
          </span>
          <span className={styles.bubbleTyped} aria-hidden="true">
            {shown}
            {shown.length < text.length && <span className={styles.caret} />}
          </span>
        </>
      ) : (
        text
      )}
    </p>
  );
}

const TYPE_FIRST_MS = 700; // on page load, after the hero has settled in
const TYPE_AGAIN_MS = 120; // after a click: answer promptly
const TYPE_STEP_MS = 24;

function useTypewriter(text, enabled) {
  const [count, setCount] = useState(() =>
    enabled && !prefersReducedMotion() ? 0 : text.length
  );
  const firstRef = useRef(true);
  useEffect(() => {
    if (!enabled || prefersReducedMotion()) {
      setCount(text.length);
      return undefined;
    }
    const startIn = firstRef.current ? TYPE_FIRST_MS : TYPE_AGAIN_MS;
    firstRef.current = false;
    setCount(0);
    let timer = 0;
    let n = 0;
    const tick = () => {
      n += 1;
      setCount(n);
      if (n < text.length) timer = window.setTimeout(tick, TYPE_STEP_MS);
    };
    timer = window.setTimeout(tick, startIn);
    return () => window.clearTimeout(timer);
  }, [text, enabled]);
  return text.slice(0, count);
}

/**
 * The hero mascot, as a button: pressing it steps through his expressions.
 * Every pose is stacked in one square frame, anchored at the bottom (the
 * poses have different shapes), and the active one fades in, so a change is
 * a crossfade with nothing moving around it. Only "welcome" loads with the
 * page; the rest are added once the page has finished loading, so they're
 * ready before anyone hovers or clicks. The celebrate pose hops as it lands.
 */
function HeroBuddy({ pose, onPoke }) {
  const [extras, setExtras] = useState(false);
  useEffect(() => {
    let idle = 0;
    let timer = 0;
    const queue = () => {
      if ("requestIdleCallback" in window) {
        idle = window.requestIdleCallback(() => setExtras(true), { timeout: 2000 });
      } else {
        timer = window.setTimeout(() => setExtras(true), 600);
      }
    };
    if (document.readyState === "complete") queue();
    else window.addEventListener("load", queue, { once: true });
    return () => {
      window.removeEventListener("load", queue);
      if (idle) window.cancelIdleCallback?.(idle);
      window.clearTimeout(timer);
    };
  }, []);

  return (
    <button
      type="button"
      className={styles.buddy}
      onClick={onPoke}
      aria-label="Jobuddy, the mascot. Press to change the expression."
    >
      {HERO_POSES.map((p) => {
        if (p !== "welcome" && !extras) return null;
        const art = POSES[p];
        const active = p === pose;
        return (
          <img
            key={p}
            src={art.src}
            width={art.width}
            height={art.height}
            alt=""
            draggable="false"
            decoding="async"
            className={[
              styles.buddyPose,
              active ? styles.buddyActive : "",
              active && p === "celebrate" ? styles.buddyHop : "",
            ].join(" ")}
            // React 18 doesn't know the camelCase prop yet; the lowercase
            // attribute passes straight through to the DOM.
            {...(p === "welcome" ? { fetchpriority: "high" } : {})}
          />
        );
      })}
    </button>
  );
}
