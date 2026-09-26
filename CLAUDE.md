# Jobassist (mock-interview) — working notes for Claude

AI-powered mock interview practice. Paste a job description, pick a question
count (2–6), a focus (mixed / behavioral / technical / system-design) and a
**mode** (type or speak), and optionally paste your resume → answer the tailored
questions in a chat → get scored feedback. Completed interviews are saved to a
per-browser history.

In **Speak mode** the candidate answers out loud on camera and the browser
measures how they delivered it — speaking pace, hesitation pauses and how much of
the answer they spent facing the camera — which is fed to the evaluator alongside
the transcript so the feedback covers presentation as well as content. See
"Speak mode" below.

A second feature, **Job Matches**, takes a resume + a city and returns real open
roles from Adzuna — searched broadly across all companies and roles, not
restricted to any particular employer — each scored against the resume by the
model. See "Job Matches" below.

A third feature, **Resume Builder**, is a split screen: chat on the left, a live
ATS-friendly resume on the right. Both the AI and the user's own inline edits
write to one shared document. See "Resume Builder" below.

All three sit behind **sign-in** (Supabase email/password). Signed-out visitors
get a public **landing page** — hero, About, How It Works (a tutorial-video slot
per feature) and a Contact footer. See "Routing", "Authentication" and "Landing
page" below.

A signed-in user is also offered an optional **career survey** once — fifteen
questions about their job search, stored in Supabase. **Nothing reads it yet.**
It exists to be wired into personalization later, deliberately and separately;
no AI prompt touches it today. See "Career survey" below.

- **Frontend:** React 18 + Vite, plain CSS Modules over a design-token layer in
  `styles/tokens.css`, icons from `lucide-react`. **React Router 7** (declarative mode, `BrowserRouter`) for
  URL-based navigation; no component library, no state library. A collapsible
  `Sidebar` carries a persistent nav inside the app so no feature is reachable only from
  the dashboard. See "Design system" below.
- **Auth:** Supabase Auth (`@supabase/supabase-js`), client-side only — the API
  server does not verify Supabase tokens. See "Authentication".
- **Backend:** Node.js + Express (ESM). No database — see "Storage" below.
- **AI:** OpenRouter chat completions, called **only** from the backend.

## Layout

```
mock-interview/
├── supabase/
│   ├── README.md                    how to apply a migration (by hand — nothing does it for you)
│   └── migrations/                  the career-survey table, and the rating tables the
│                                    n8n email writes to; see "Career survey"
├── n8n/                             two importable workflows: the post-survey rating
│                                    email and the webhook that records the answer.
│                                    Outside the app entirely — see "Website ratings"
├── server/
│   └── src/
│       ├── index.js                 app wiring: CORS, headers, rate limit, auth, routes
│       ├── config.js                all env-driven config in one object
│       ├── timeLimit.js             heuristic: question text → answer seconds (60–300)
│       ├── routes/                  thin route → controller mapping
│       ├── controllers/             request validation + orchestration
│       ├── services/
│       │   ├── openrouter.service.js  the ONLY module that talks to OpenRouter
│       │   ├── modelBudget.js         3 model-call pools (interview/jobs/resume) + daily cap
│       │   ├── session.service.js     in-memory live sessions (Map), 1h TTL
│       │   ├── history.service.js     flat-file completed-interview store
│       │   ├── jobs.service.js        Adzuna fetcher + normalizer
│       │   └── resume.service.js      resume doc shape: normalize + model-turn interpreter
│       ├── middleware/
│       │   ├── auth.js              requireApiToken + attachClientId + assertOwner
│       │   └── rateLimit.js         in-memory per-key sliding window
│       ├── controllers/            interview, interviews, jobs, resume
│       └── prompts/index.js         interviewer + evaluator + job-match + resume prompts
│   └── test/                        node:test unit tests (`npm test`)
└── client/
    └── src/
        ├── main.jsx                 ErrorBoundary → BrowserRouter → AuthProvider → App
        ├── App.jsx                  the route table (public routes + one guarded layout route)
        ├── routes.js                PATHS — every app path, no component imports
        ├── AppWorkspace.jsx         signed-in layout: interview/jobs state, sessionStorage mirror,
        │                            Sidebar, and the thin `*Route` wrappers for each screen (lazy chunk)
        ├── auth/                    supabaseClient.js, AuthProvider.jsx (useAuth), RequireAuth.jsx (guard)
        ├── survey/                  the career survey, and the ONLY code that touches Supabase
        │                            data: surveyQuestions.js (the 15 questions as data),
        │                            surveyMapping.js (pure answers ↔ row), surveyApi.js
        │                            (the table), useSurvey.js (prompt/completed state).
        │                            Read by no AI prompt — see "Career survey"
        ├── styles/tokens.css        every design token (dark only) — see "Design system"
        ├── index.css                imports the tokens; base styles, app frame, shared classes
        ├── identity.js              owner id → X-Client-Id (Supabase user id when
        │                            signed in, random per-browser id when not)
        ├── constants.js             limits + timeout; keep in sync with server config.js
        ├── api/                     client.js (fetch wrapper) + one module per resource (jobsApi, resumeApi, …)
        ├── screens/                 Landing (public), SignIn, ResetPassword (public), Home
        │                            (dashboard + history), JobDescription
        │                            (JD + options), Chat, Results, HistoryDetail, JobMatches,
        │                            ResumeBuilder, Survey (the optional career survey)
        ├── components/              Sidebar (app nav + AccountMenu), AccountMenu (avatar,
        │                            email, survey link, sign out), SurveyBanner (the one-time prompt),
        │                            PublicHeader (site nav + Sign In),
        │                            SiteFooter (Contact), VideoPlaceholder,
        │                            AppSkeleton (pre-render placeholder for protected pages),
        │                            ChatInput (voice/text), ChatMessage, FeedbackReport,
        │                            InterviewRow, JobRow, CameraPreview (speak-mode self-view), ResumePreview,
        │                            ResumeChatPanel, EditableText, and the shared primitives:
        │                            Icon (lucide map), SegmentedControl, Toast
        ├── utils/score.js           score → { color, soft, label } band, shared by every score chip
        ├── utils/parseResume.js     client-side PDF/text → resume text (lazy-loads pdfjs-dist)
        ├── utils/resumeModel.js     resume doc shape + immutable edit helpers
        ├── utils/resumeExport.js    PDF / print-PDF / JPG / PNG / TXT (lazy html2canvas + jsPDF)
        ├── utils/deliveryMetrics.js pure: loudness samples → pause count/total + speaking time + wpm
        ├── utils/faceTracker.js     MediaPipe Face Landmarker → on-camera % (lazy, fails soft to null)
        ├── hooks/useSpeechRecognition.js   Web Speech API wrapper, client-only
        └── hooks/useDeliveryCapture.js     owns the camera+mic stream, analyser and face tracker
    └── test/                        node:test unit tests for the pure utils (`npm test`)
```

## Run it

```bash
# from repo root
npm run install:all      # root + server + client
npm run dev               # concurrently runs server:3001 and client:5173
```

Vite proxies `/api` → `localhost:3001`, so no CORS setup in dev.

- Server env: copy `server/.env.example` → `server/.env`, add `OPENROUTER_API_KEY`.
  For Job Matches also add `ADZUNA_APP_ID` / `ADZUNA_APP_KEY` (free keys from
  https://developer.adzuna.com) — Adzuna is the sole Job Matches data source, so
  without them the feature returns a warning and no jobs.
- Client env (`client/.env`, see `client/.env.example`): **`SUPABASE_URL` and
  `SUPABASE_ANON_KEY` are required** to sign in — without them the public pages
  still render but every app route redirects to `/sign-in`, which shows a
  "not configured" banner. Restart Vite after changing them. Optionally
  `VITE_API_BASE_URL` (no proxy) or `VITE_API_TOKEN` (server has `API_TOKEN` set).
- Tests: `cd server && npm test`, and `cd client && npm test` (node:test, no
  bundler — so it covers only what imports cleanly outside Vite: the pure utils
  (`utils/deliveryMetrics.js`), the design-token contract, and the survey's questions ↔
  migration ↔ row mapping. There is still no component/DOM test runner. Anything
  reading `import.meta.env` — the Supabase client, and so `survey/surveyApi.js`
  — throws under plain node, which is why the survey's pure half lives in its
  own module.)
- **The career survey needs a migration applied by hand** before it does
  anything: `supabase/migrations/` → Supabase SQL Editor. Without it the feature
  switches itself off rather than erroring. See "Career survey".

## Design system

**Jobassist** is dark-only: a dense, Linear/Vercel-style dev-tool look over an
"underwater" palette — abyssal blues, with a soft aqua accent used sparingly
(primary buttons, the active nav item, focus rings, key numbers).

`client/src/styles/tokens.css` is the single source of visual truth;
`index.css` `@import`s it and holds only base styles, the layout shell and the
shared classes. Module CSS styles **through the tokens** — no raw hex/rgb, font
size, spacing value or radius belongs in a `*.module.css` file. If a value is
missing, add it to `tokens.css`. `client/test/themeTokens.test.js` enforces
this: the brief's palette values, no custom properties declared outside
`tokens.css`, no raw colours in module CSS, and no `var(--x)` that isn't
declared (an undeclared token fails silently in the browser).

- **Palette:** `--bg` #070d14, `--surface` #0c1622, `--surface-raised`
  #122030, `--border` #1c2e40, `--text`, `--text-muted`, `--accent` #4fd1c5,
  `--accent-soft`, `--secondary` #7aa7ff (links, sparingly), and score colours
  `--good/--okay/--weak`. Everything else (`--surface-sunken`, `--border-strong`,
  `--text-subtle`, `--accent-border`, semantics, `--band-*`) derives from those.
  Score bands keep their own names because `utils/score.js` applies them inline.
  **A warning is amber** — `.warn-banner`, never the accent.
- **Scales:** 4px spacing grid (4 · 8 · 12 · 16 · 24 · 32 · 48 — the older
  `--sp-5/8/10/11/12` names survive, snapped onto it); radii 6px for controls
  (`--radius-sm/md`), 10px for cards (`--radius-lg/xl`), nothing rounder —
  `--radius-pill` is 6px under its old name, and `--radius-round` (50%) is for
  avatars and dots only. Base size 14px. Inter for UI, JetBrains Mono (`.mono`,
  `<time>`, `--font-mono`) for numbers, scores, dates and small uppercase labels.
  Both fonts load from Google Fonts in `index.html`.
- **No shadows, no gradients.** Separation is a 1px `--border`. Every
  `--shadow-*` is `none` except `--shadow-popover` (floating menus only).
  The one gradient is `--gradient-hero`, a faint teal pool in the page corner
  (`body::before`); `--gradient-accent` is a flat colour under an old name. No
  gradient text, no blur/glass, no `backdrop-filter`.
- **Motion:** transitions on hover/focus/collapse only, 120–180ms ease-out.
  Nothing lifts, scales or fades in on mount. The only animations left are
  status indicators: skeleton shimmer, typing dots, the Job Matches progress
  bar, and a steps() REC blink while recording.
- **Buttons:** `.btn-primary` = solid aqua with dark text (`--accent-contrast`);
  `.btn-ghost` = transparent with a border (the "secondary" button);
  `.btn-subtle`; `.btn-danger` (outlined red). 32px (`--control-height`).
- **Form controls** get one global look in `index.css` (raised fill, border,
  aqua edge + soft ring on focus) through a zero-specificity `:where()`, so any
  module class overrides it. Every interactive element gets the 2px aqua focus
  ring.
- **Shared classes** in `index.css`: `.btn-*`, `.link-btn`, `.card`,
  `.page-head` (the title-left / primary-action-right row every app page opens
  with), `.error-banner`, `.warn-banner`, `.info-banner`, `.skeleton`,
  `.eyebrow`, `.mono`, `.sr-only`, `.no-print`. These are global, so a CSS
  module **cannot** target them by name — `.x > .btn-primary` compiles to a
  hashed selector that matches nothing. Use `:global(.page-head)` or add a
  module class.
- **Icons** are `components/Icon.jsx` — a name → lucide-react map, always 16px
  at stroke 1.5 (the `size` prop is ignored on purpose). GitHub is a hand-drawn
  path because lucide 1.x dropped brand marks. Decorative (`aria-hidden`)
  unless given a `title`. No emoji in the chrome.
- **App shell:** `AppWorkspace` renders `.app-frame` → `components/Sidebar`
  + `<main class="app-main app-shell">`. The sidebar is sticky, 240px or a 56px
  icon rail with instant CSS tooltips; the toggle button and the `[` key flip it
  (ignored while typing in an input, textarea or contentEditable, or with a
  modifier), and the choice persists in localStorage
  (`jobassist:sidebarCollapsed:v1`). Below 768px it is always the rail. The
  account menu (avatar from `user_metadata.avatar_url`/`picture`, initial
  otherwise) sits at its foot and opens upward — or rightward from the rail.
  **`.app-shell` must not get a `z-index`**: that makes it a stacking context
  and traps the Resume Builder's fixed fullscreen layer under the sidebar.
- **Never render nothing while waiting.** `components/AppSkeleton.jsx` is the
  fallback for both pre-render waits on a protected route — `RequireAuth` while
  the stored session is read, and `App.jsx`'s `<Suspense>` while the workspace
  chunk downloads. It mirrors the sidebar frame so nothing jumps.
- **Screen slot:** each route's screen renders into `.screen-slot.screen-enter`
  keyed on the pathname. The slot must stay a growing flex column —
  ChatScreen and ResumeBuilderScreen depend on `flex: 1; min-height: 0` to
  scroll internally. `.screen-enter` no longer animates.
- **Lists are dense rows, not cards.** Home's history (`InterviewRow`) and Job
  Matches (`JobRow`) are table-style rows inside one bordered surface, hover
  highlighted, with mono dates and small mono score pills. Home's column header
  template must total the same width as a row's — see the comment in
  `HomeScreen.module.css`. `FeedbackReport` is one surface with sections
  divided by 1px rules, opening on the big mono score.
- **Reduced motion** is handled once, globally.
- **Public pages** (landing) wrap in `.public-site` and render their body in
  `.app-shell.app-shell--public` (`--shell-width-public`, 1080px). The wrapper
  is load-bearing: `#root` is pinned to `height: 100%`, and a sticky element
  only sticks inside its parent's box. `--public-header-offset` (declared in
  `tokens.css`, bumped under 680px) is the `scroll-margin-top` for sections
  scrolled to from the nav. Sign-in and reset-password are bare centred pages
  with no header.

## Routing

React Router 7 in declarative mode (`import … from "react-router"` — v8 needs
React 19 / Node 22, so it's pinned to 7.x). `App.jsx` is the whole route table;
`routes.js` holds `PATHS` so nothing hardcodes a path string.

| Path | Access | Renders |
| --- | --- | --- |
| `/`, `/about`, `/how-it-works`, `/contact` | public | `LandingScreen` (scrolls to the section) |
| `/sign-in` (`?mode=sign-up`, `?mode=forgot`) | public; a signed-in visitor is redirected on | `SignInScreen` |
| `/reset-password` | public (arrives with a recovery session) | `ResetPasswordScreen` |
| `/dashboard` | protected | `HomeScreen` (history + the three features) |
| `/interview/new` | protected | `JobDescriptionScreen` (setup) |
| `/interview` | protected | `ChatScreen` (live interview) |
| `/interview/results` | protected | `ResultsScreen` |
| `/history/:interviewId` | protected | `HistoryDetailScreen` |
| `/jobs` | protected | `JobMatchesScreen` |
| `/resume` | protected | `ResumeBuilderScreen` |
| `/survey` | protected | `SurveyScreen` (the optional career survey) |
| `*` | — | redirect to `/` |

- **One guard, one layout.** All protected paths are children of a single
  pathless layout route: `<RequireAuth><AppWorkspace/></RequireAuth>`.
  `AppWorkspace` owns what `App.jsx` used to (active session + transcript,
  feedback, save state, `jobsResult`) and stays mounted while children change,
  so state survives navigation exactly as it did with the old `screen` string.
  Children read it via `useOutletContext()` in the thin `*Route` components at
  the bottom of `AppWorkspace.jsx`, which pass each screen **the same callback
  props it always had** — the screens know nothing about URLs.
- **The signed-in app is a lazy chunk.** `App.jsx` `React.lazy`s the layout and
  each `*Route` export from the same module, so landing-page visitors don't
  download it. The first render of each lazy child suspends for a tick, which is
  why there's a `<Suspense>` **inside** `AppWorkspace` around the `<Outlet>`:
  without it the suspension reaches the boundary above the layout, unmounts it,
  and throws away a live interview.
- **History entries:** starting an interview `replace`s `/interview/new` with
  `/interview`, and finishing `replace`s `/interview` with `/interview/results`,
  so Back never lands on a spent setup form or a finished chat.
- **Refresh:** the sessionStorage mirror (`{ session, messages, feedback }`) is
  read only when the workspace mounts on `/interview` or `/interview/results`;
  any other path starts clean, as non-resumable screens always did. A reload on
  the results page re-fires the idempotent save.
- The header nav (and Sign out) is disabled on `/interview`, as before. The
  browser Back button is not blockable in declarative mode; going Back from a
  live interview unmounts `ChatScreen` (camera released as on any unmount) but
  keeps the session in workspace state until "Start an interview" clears it.
- **Deploying:** it's a client-side router — the static host must rewrite
  unknown paths to `index.html` (SPA fallback) or a refresh on `/jobs` 404s.
  Vite's dev and preview servers already do this.

## Authentication

Supabase Auth: email + password (with sign-up on the same page), plus **Google
and GitHub** OAuth. The page leads with "Continue with Google" (the primary
button), then GitHub as a secondary one; the email form is folded behind
"Continue with email" (local `emailOpen` state, purely visual) unless the
visitor arrived on `?mode=sign-up` / `?mode=forgot`, or switches mode.

- **OAuth flow:** `signInWithProvider(provider, { returnTo })` builds the URL
  with `skipBrowserRedirect`, first checks `GET /auth/v1/settings` (public,
  `fetchEnabledProviders`) so a provider that's switched off shows a friendly
  error instead of dead-ending on Supabase's raw JSON page, then leaves via
  `window.location.assign`. The browser returns to `/sign-in`, where
  `detectSessionInUrl` stores the session and the normal `user` → `<Navigate>`
  path takes over. Router state doesn't survive the round-trip, so the deep-link
  destination rides in sessionStorage (`mockInterview:authReturnTo`,
  `takeAuthReturnTo`). A provider-side failure comes back as
  `error_description` in the hash/query; `SignInScreen` shows it once and strips
  it from the URL.
- **OAuth config lives outside the code.** Each provider needs, in its own
  console, the callback `https://<project-ref>.supabase.co/auth/v1/callback`
  (Google Cloud → Credentials → OAuth client → Authorized redirect URIs;
  GitHub → Settings → Developer settings → OAuth Apps → Authorization callback
  URL), and in Supabase → Authentication → Sign In / Providers the real
  **Client ID** + secret. The app origin's `/sign-in` must be in Supabase's
  Redirect URLs, as for email confirmation.
- Once signed in by any method the session persists like any other — no
  re-authentication per visit.

- **Env:** `SUPABASE_URL` and `SUPABASE_ANON_KEY` in `client/.env`, read via
  `import.meta.env`. They keep their plain names because `vite.config.js` sets
  `envPrefix: ["VITE_", "SUPABASE_"]` — so **never put a secret in any
  `SUPABASE_*` var** (e.g. the service_role key): everything matching the prefix
  is bundled into the client. The anon key is public by design.
- `auth/supabaseClient.js` creates the one client, or `null` when either var is
  missing or the URL is malformed (so the public pages still render).
  `persistSession` + `autoRefreshToken` keep the user signed in across reloads
  (storage key `mockInterview:auth:v1`); `detectSessionInUrl` completes the
  email-confirmation redirect.
- `auth/AuthProvider.jsx` → `useAuth()` = `{ session, user, loading, configured,
  signIn, signUp, signOut }`. `loading` is true only until the stored session
  has been read; **`RequireAuth` must wait on it**, or every refresh of a
  protected page bounces a signed-in user to `/sign-in`.
  `onAuthStateChange` is the single writer after that (sign-in, sign-out, token
  refresh, sign-out in another tab). Supabase error strings are mapped to plain
  messages in `friendlyAuthError`.
- **Redirects.** Signed out on a protected path → `/sign-in` with
  `state.from`. `SignInScreen` has no navigate-on-success: when `user` becomes
  non-null it renders `<Navigate to={from ?? "/dashboard"}>` (same-app paths
  only), which covers sign-in, instant sign-up, and a confirmation link return.
- **Sign-up.** With email confirmation on (the Supabase default) sign-up returns
  no session; the screen switches to Sign in with a "check your email" notice.
  `emailRedirectTo` is `<origin>/sign-in` — add that URL to Supabase → Auth →
  URL Configuration → Redirect URLs for each environment. Client-side minimum
  password length is 8 on sign-up only (existing accounts aren't re-validated).
- **Password reset.** `/sign-in?mode=forgot` is a third mode of the same screen
  (reached from "Forgot?" next to the Password label): email only, no OAuth
  buttons, and a notice worded identically whether or not the address has an
  account — Supabase won't say, so neither do we. `resetPasswordForEmail` sends
  a link to **`<origin>/reset-password`**, which must be in Supabase → Auth →
  URL Configuration → Redirect URLs alongside `/sign-in`.
  `screens/ResetPasswordScreen.jsx` is a **public** route: the link establishes
  a recovery session of its own, and the person is there precisely because they
  can't sign in. No session on arrival (link unused, already spent, or expired)
  → one message covering all three plus a way to request another. It reuses
  `SignInScreen.module.css` so the two can't drift apart.
- **Sign out** is in the sidebar's `AccountMenu`.
  `AppWorkspace.handleSignOut` navigates to `/` **first** — otherwise
  `RequireAuth` would see the session vanish and send the user to `/sign-in` —
  then `signOut()` (scope `local`) clears the interview mirror, the Job Matches
  cache and results (`JOBS_STORAGE_KEY`, `JOBS_RESULT_KEY`) **and the anonymous
  browser id** so the next person on that browser inherits nothing.
- **History is scoped to the account.** `identity.js` sends `X-Client-Id`, and
  `AuthProvider` calls `setUserScope(user.id)` on every auth transition — so a
  signed-in user's id is `u-<supabase user id>` and history follows the account
  across devices. Signed out it falls back to the random per-browser id, which
  keeps the app usable without auth. The scope is set **inside the
  `getSession`/`onAuthStateChange` handlers, before `setSession`**, so the first
  request a protected screen makes is already scoped correctly.
- **What this is not:** a server-side access boundary. The route guard is UX and
  the owner id is still a client-supplied header, so `/api` accepts whatever
  owner a caller names (subject to `API_TOKEN`). What the user scope fixes is
  the honest-user case — two accounts on one laptop, one account on two
  machines. Making it a real boundary means sending the Supabase access token,
  verifying it server-side (JWT secret / JWKS), and reading `ownerId` off the
  verified token instead of the header.

## Landing page

`screens/LandingScreen.jsx`: `PublicHeader` → hero → About → How It Works →
closing CTA → `SiteFooter` (Contact). One scrolling page; the four public paths
all render the same element, so React Router keeps it mounted and moving
between them is a scroll. The scroll effect keys on `location.key` (clicking
the same link again still scrolls), jumps on first load and glides afterwards
unless reduced motion is on, and moves focus to the section's `h2`
(`tabIndex=-1`) so keyboard users land where they asked.

- **PublicHeader:** text wordmark ("Jobassist", no logo graphic), About / How
  It Works / Contact as `NavLink`s, and **Sign in as a `.btn-primary`**
  ("Dashboard" when signed in). Under 680px the three links drop to a second
  row. `/sign-in` and `/reset-password` don't render it — they're bare,
  centred pages with their own skip link.
- **About:** placeholder copy plus three non-interactive pillars (interview,
  jobs, resume).
- **How It Works:** `HOW_IT_WORKS` in `LandingScreen.jsx` — Resume Builder, Job
  Finder, Mock Interview — each with summary, three steps and a
  `VideoPlaceholder`. **To add a tutorial** set that entry's `video.src` (a file
  in `client/public/`, e.g. `/videos/resume-builder.mp4` → native `<video>`) or
  `video.embedUrl` (e.g. a YouTube embed URL → iframe). Empty = labelled
  placeholder. Rows alternate sides on desktop; DOM order stays copy-first.
- **Contact:** `SiteFooter` (`id="contact"`) — `mailto:` email and GitHub link
  (new tab, `noopener noreferrer`). Constants at the top of the file.
- The hero's product preview is decorative, static and `aria-hidden`.
- All copy is placeholder and meant to be edited in place — but **keep it
  short**. Pillars and walkthrough summaries are one sentence each by design;
  they were paragraphs, and three paragraphs side by side get skipped wholesale
  on a landing page. The same rule cost the dashboard its hero and then its
  feature cards: `HomeScreen` is a "Home" header row, a mono stats strip and
  the history as dense rows — the features are in the sidebar — and its empty
  state is one line plus "Start new interview".
- **A skip link** (`.skip-link` in `index.css`) sits first inside `PublicHeader`
  (and first on the sign-in / reset pages) and targets `#main-content`, which
  every screen puts on its `<main>` — including `AppWorkspace`'s.

## Speak mode

Chosen on the setup screen ("How you'll answer": Type / Speak) and carried on the
session as `mode`. **Type mode is the default and is untouched by any of this** —
same request bodies, same evaluator prompt, no permissions requested, no hardware
opened. Every branch below is gated on `mode === "speak"`.

The point is that a real interview is lost on delivery as often as on content.
Speak mode measures three things while the candidate answers, entirely in the
browser, and hands them to the evaluator so the report covers presentation too.

### Permissions, and falling back

`JobDescriptionScreen` explains *why* before the browser ever prompts ("your pace,
pauses and eye contact are measured live — nothing is recorded or sent anywhere"),
then calls `probeMediaPermission()` (exported from `useDeliveryCapture.js`), which
asks for camera+mic **and immediately stops the tracks again**. It's a "will this
work?" check — the setup screen has no business holding the camera open while
someone reads a job description. The browser remembers the grant, so `ChatScreen`'s
real `request()` a moment later reuses it and the candidate sees exactly one
prompt.

Refusal is never fatal and never silent: the segmented control snaps back to Type,
an amber `.warn-banner` says which device failed and why, and `effectiveMode`
(what actually gets sent) can only be `"speak"` once permission is in hand. If the
grant evaporates later, `ChatScreen` shows the same fallback and the interview
carries on as a typed one.

### The metrics

Computed per answer, accumulated across re-recordings (the tracker is segmented,
matching the way `ChatInput` appends each new transcript onto the draft):

| field | meaning |
| --- | --- |
| `wpm` | words ÷ spoken window (first word → last word, pauses included) |
| `pauseCount` | silences ≥1.5s **with speech on both sides** |
| `pauseMs` | total time in those pauses |
| `speakingMs` | time actually spent speaking |
| `onCameraPct` | share of samples where a face was present and facing the screen |

- **Audio** (`utils/deliveryMetrics.js`, pure and unit-tested): an `AnalyserNode`
  RMS sample every 50ms, hysteresis (150ms in, 250ms out) so word gaps aren't
  pauses, and a noise floor learned **only from samples already judged silent**.
  That last rule is load-bearing — see Gotchas.
- **Video** (`utils/faceTracker.js`): 10fps, yaw/pitch from the face's forward
  vector; on-screen is `|yaw| ≤ 25°` and `|pitch| ≤ 20°`. Deliberately generous:
  a false "you looked away" is worse feedback than none.
- **Leading and trailing silence are excluded** — that's setup and wrap-up, not
  hesitation.
- **A metric that couldn't be measured is `null`, never `0`.** "0 pauses" reads to
  the evaluator as a fact about the candidate; it must not be told that when the
  truth is "we never heard them". `wpm` is also suppressed under 5s or 10 words,
  where it would be arithmetic rather than information. Likewise, if **not one
  frame** of an answer contained a face, `onCameraPct` is `null` rather than 0 —
  a covered lens, a dark room, or Chrome defaulting to an idle virtual camera is
  far likelier than someone facing away for every second, and 0 would have the
  evaluator tell them they never made eye contact. (This is not hypothetical: it
  is exactly what a phone-as-webcam virtual camera does when the phone app isn't
  streaming.)

### Face tracking: MediaPipe Tasks Vision

`@mediapipe/tasks-vision`, pinned exactly (`0.10.21`), lazy-`import()`ed only when
a Speak-mode interview starts — the same pattern as `pdfjs-dist` in
`parseResume.js`. Chosen because `outputFacialTransformationMatrixes` gives real
head pose from a rotation matrix rather than a guess inferred from 2D landmark
spacing; `face-api.js` is unmaintained and TF.js BlazeFace degrades badly at angle.

The WASM runtime and the ~3.8MB model are fetched from a **pinned CDN**
(jsdelivr + Google's model bucket) — two constants at the top of
`faceTracker.js`, kept in step with the npm version. To self-host, drop both into
`client/public/` and change those two strings. If either fetch fails, the tracker
resolves to `null`, `onCameraPct` stays `null`, and pace/pauses carry on alone.

### Privacy — what does and doesn't leave the browser

- The `MediaStream` has exactly two consumers, both local: a `<video>` for the
  self-view and an `AnalyserNode` for loudness. There is **no `MediaRecorder`, no
  canvas capture, no blob, no upload path** — the code never produces a media file
  at all. MediaPipe runs as WASM in the tab and reads the `<video>` directly.
- The only thing added to the answer POST is five bounded integers.
  `normalizeDelivery` rebuilds that object from a numeric allowlist and returns
  `null` for a type-mode session, so no client can attach delivery data — or
  anything else — to an interview that wasn't spoken.
- **The honest caveat:** the *transcript* still comes from the Web Speech API,
  which in Chrome sends audio to Google. That predates this feature and is what
  the dismissible note in `ChatInput` discloses; the note gains a sentence in
  Speak mode making clear the pace/pause/camera half is local. Don't ever write
  copy claiming "nothing leaves your browser" without that distinction.
- **Teardown** is one function, `release()` in `useDeliveryCapture.js`: tracks
  stopped, `AudioContext` closed, landmarker closed, timers cleared. It fires on
  interview end, on scoring, on leaving the screen, on mode change and on unmount.
  One place to get right, so the camera light can't outlive the interview.

### Wiring

`ChatInput` owns the mic button and reports transitions up via `onRecordingChange`;
`ChatScreen` starts/stops measurement in lockstep and calls `collect(text)` at
submit time — including on a skip or a timeout, where whatever was said before
giving up is still that question's delivery. `session.mode` rides in
`sessionStorage`, so a refresh mid-interview resumes in the same mode.

### Feedback

`transcriptForEvaluator` adds a `D` line under the answer
(`D3: pace 168 wpm · 4 pauses totalling 11s · looking at camera 52% of the time`),
and `evaluatorSystemPrompt(jd, { mode })` appends `DELIVERY_GUIDANCE`: reference
bands (110–160 wpm conversational, <95 slow, >185 rushed), a requirement to pair
any delivery criticism with a concrete fix, credit for good delivery as well as
bad, and the nervousness rule — only when several signals co-occur, framed as how
it *comes across*, never as a claim about how the candidate felt, and never a
diagnosis. **Delivery never moves a `score`**; scores stay content-only so a good
answer delivered nervously isn't penalised twice.

Nothing renders the metrics in the UI by design — they exist to inform the written
feedback. They do persist on `qaPairs`, so they're in saved history if that changes.

## Job Matches

Reached from the dashboard ("Find job matches") or the header nav. Route:
`/jobs` → `JobMatchesScreen`.

The flow is **two-phase** so results show immediately and scores fill in
progressively instead of one ~1-minute blocking request. The result is cached in
`AppWorkspace.jsx` state (`jobsResult`), so leaving the screen and returning doesn't
re-spend model calls.

1. The user uploads a resume (PDF or `.txt`), picks a country, and enters a
   city. PDF text is extracted **in the browser** by `utils/parseResume.js`
   (lazy-loads `pdfjs-dist`); the server only ever receives plain text, and the
   UI never displays it — after a successful upload the screen shows only a
   confirmation (filename + character count + a checkmark), never the resume
   text itself. Resume + city + country are cached in `localStorage`
   (`mockInterview:jobs:v1`) so they survive a reload, still never rendered; the
   resume text (only) is dropped after a 7-day TTL and the user re-uploads.
2. `POST /api/jobs/search` `{ resumeText, city, country }` (`jobs.controller.js`):
   - One model call turns the resume into a search profile
     `{ field, seniority, keywords[], titles[] }` (`kind: "jobs"` budget pool).
   - One Adzuna search using that profile, broad across all companies/roles, in
     the chosen country (`resolveAdzunaCountry` validates the code; unsupported
     → 400), filtered to the user's city. `what` (AND match) is tried first and,
     if it returns nothing, `what_or` (OR match) is retried once before giving
     up. Adzuna failing is a non-fatal `warning`, never a crash.
   - Dedupe (by id, then company+title), take the top `JOB_MATCH_MAX_SCORED`
     (default 12) in Adzuna's relevance order.
   - Response: `{ profile, jobs[], warnings[], message }` — jobs **unscored**
     (`matchScore: null`), each carrying a trimmed `description` + `postedAt` so
     the next phase is stateless. `message` set (+ `jobs` empty) for "nothing
     found".
3. `POST /api/jobs/score` `{ resumeText, jobs: [...] }` — scores one small batch
   (≤ `JOB_MATCH_SCORE_BATCH_MAX`, default 4) against the resume, one model call
   each (`jobMatchSystemPrompt`, `JOB_MATCH_SCORE_CONCURRENCY` in parallel, in
   the `jobs` pool). Returns `{ scores: [{ id, matchScore, reason }] }`. The
   client (`JobMatchesScreen`) loops this a batch at a time, merging scores by
   id and re-rendering as each batch lands. A batch that fails leaves those jobs
   `null`; a "Score remaining" button retries them.
   The finished result is cached twice: in `AppWorkspace` state (survives in-app
   navigation) and in `sessionStorage` under `JOBS_RESULT_KEY` (survives a
   reload). A search is ~13 model calls, so losing them to a refresh was
   expensive — and on the free tier the re-run comes back with more `null`
   scores than the first did. Cleared on sign-out with the other keys.
   `settled` on each job (not the run status) drives the card's "Scoring…"
   spinner, so a role the model declines mid-run stops spinning immediately
   instead of showing "Scoring…" next to "Couldn't score this role".
   Once results exist the search form collapses to a one-line summary
   ("<file> · <city>" + "Change search"); it stays expanded while a search runs,
   and when a search returns nothing, because that's when the fields are what
   the user needs.
4. **Recency breaks the "best match" tie**, and `JobRow` badges anything older
   than `STALE_AFTER_DAYS` (60) with an amber "May have closed". Match score
   alone happily floated a 13-month-old listing to the top of the page, and a
   role that isn't open any more is worth nothing however well it fits. We can't
   know whether it's closed, hence a badge rather than a filter.
5. While scoring, cards hold Adzuna's relevance order (no jumping) and no
   filter is offered — sorting or filtering mid-stream would make cards jump as
   scores land. Once `status === "done"` the user can sort by best match or most
   recent and filter by score floor, posted window, "has salary" and "remote".
   **Those filters are client-side, over what already came back** — the Adzuna
   query itself is city-scoped server-side, so "remote" matches on the returned
   title/location text rather than re-running the search. `JobRow` renders company,
   title, location, salary (in the country's own currency), `postedAt` as a
   relative label, score band (`utils/score.js`), the one-line reason, and a
   validated http(s) link. All of it is model-/API-sourced text — text only.

### Data source — and why not LinkedIn/Indeed

`jobs.service.js` calls **Adzuna** (`api.adzuna.com`), a documented/public JSON
job-board aggregator API, as the sole source — searched broadly across all
companies and roles using keywords the model pulled from the resume
(`what=<profile.field>`, AND match; falls back to `what_or` OR match when there's
no usable field, or when the AND match returns zero results), filtered to the
user's city + a `distance` radius, both handled server-side at Adzuna. It never
scrapes rendered HTML from LinkedIn, Indeed,
Glassdoor, or any company's own careers site — those forbid scraping in their
ToS, block it, and break constantly. (An earlier version of this feature also
hit NVIDIA/AMD/Apple's individual career-page APIs directly; that was removed
so the search isn't restricted to a fixed set of companies — Adzuna alone
already covers listings across employers broadly.)

Adzuna is partitioned by country — the code goes in the request path
(`/jobs/{country}/search/1`). The client sends the user's picked country; the
19 Adzuna serves are `gb us at au be br ca ch de es fr in it mx nl nz pl sg za`
(kept in `adzuna.supportedCountries` in `config.js` ↔ `ADZUNA_COUNTRIES` in
`client/src/constants.js` — `server/test/countrySync.test.js` fails if they
drift). Adzuna returns salaries as bare numbers with no currency field, so
`config.adzuna.currencyByCountry` maps each code → `{ locale, currency }` and
`formatSalary` renders in the right currency (was always USD before).

### New env vars (all optional; see `server/.env.example`)

- `ADZUNA_APP_ID`, `ADZUNA_APP_KEY` — Adzuna credentials, required for Job
  Matches to return anything. Missing → the feature returns a warning and no
  jobs.
- `ADZUNA_COUNTRY` (default `us`) — server-side fallback only; the UI always
  sends the user's chosen country, so this matters only for direct API calls.
- `JOB_MATCH_*` tuning knobs (`ADZUNA_RESULTS`, `ADZUNA_DISTANCE_KM`,
  `MAX_SCORED`, `SCORE_CONCURRENCY`, `SCORE_BATCH_MAX`, `MODEL_CONCURRENCY`,
  `RATE_LIMIT_MAX`).

### Backend endpoints

- `POST /api/jobs/search` and `POST /api/jobs/score` — both behind
  `requireApiToken` + `attachClientId` + a per-IP rate limit
  (`JOB_MATCH_RATE_LIMIT_MAX`, default 20/min). Model calls run in the separate
  `jobs` pool (`JOB_MATCH_MODEL_CONCURRENCY`) so a burst of Job Matches traffic
  can't starve live interviews of the shared budget.

## Resume Builder

Reached from the dashboard ("Build a resume") or the header nav. Route:
`/resume` → `ResumeBuilderScreen`. Session-only — nothing is persisted, by
design; leaving the screen discards the draft.

**One document, two writers.** The whole feature turns on a single piece of
state: `resume` in `ResumeBuilderScreen`. The preview renders from it, inline
edits write to it, the chat request sends it, and every exporter reads it. There
is no second copy and nothing reconstructs a resume from the chat transcript.

`POST /api/resume/chat` `{ messages, resume }` → `{ reply, resume, changed }` is
**stateless** (like Job Matches): the client owns the conversation and the live
document and re-sends both every turn. The server builds the model call as
`system + prior turns + one final user message embedding the CURRENT resume JSON
alongside the newest instruction` (`resumeTurnMessage`). That is what stops an
AI reply resurrecting stale content: the document the model edits is always the
one the user is looking at, hand edits included. The model returns the whole
document (not a patch); `resume: null` means "nothing changed" and the client's
copy is kept as-is rather than round-tripped.

- The shape lives in `server/src/services/resume.service.js` — contact / summary
  / experience / education / skills / projects / certifications, single column.
  `normalizeResume` is the only way a resume enters the system and runs over
  **both** directions of untrusted input (what the client posts *and* what the
  model returns), coercing types and applying every cap in `RESUME_LIMITS`.
  Client mirror of the caps: `RESUME_LIMITS` in `client/src/constants.js`.
- `interpretModelTurn` tolerates two output shapes: the intended
  `{ reply, resume }` envelope, and a **bare resume object** with the envelope
  dropped — which the configured `:free` model does routinely. Without that,
  every turn on a small model would be silently discarded.
- Entry `id`s round-trip through the model and the normalizer so React keys and
  in-progress edits survive an AI rewrite.

**Leaving throws the document away** — nothing is persisted, by design. Two
guards make that a choice rather than an accident: `setLeaveGuard` (handed down
from `AppWorkspace`) confirms in-app navigation — header nav, Back to home, sign
out — and a `beforeunload` listener covers reload, tab close and the browser's
own Back button, which React Router's declarative mode cannot intercept. Both
arm only when `isResumeEmpty` is false. `AppWorkspace` funnels every nav button
through `guarded()`, which is the only place a screen can veto a navigation.

**Undo.** Because the model returns the whole document rather than a patch, one
bad turn can flatten hand-written bullets. Every write through `setResume` pushes
the previous document onto `undoRef` with a label ("your edit" / "the AI
rewrite"), capped at 30, and the toolbar's Undo button pops it — so the button
can say precisely what it will take back. The stack lives in a ref; the only part
render needs is `undoLabel`, whose transitions coincide exactly with the
enabled/disabled transitions of the button. This is an undo affordance, not
document history — there is no redo, and nothing survives leaving the screen.

**The editing lock.** While a turn is in flight, `busy` is true: every
`EditableText` goes `contentEditable=false`, add/remove/reorder controls are
hidden, an overlay + "AI is writing" badge covers the sheet, and the chat's Send
button becomes Stop.

**What Stop does.** The call isn't streamed, so there's no partial output to
halt. Stop (a) aborts the HTTP request through an `AbortController` — the
`request()` wrapper in `api/client.js` composes a caller `signal` with its own
timeout, and a caller-abort throws an error tagged `.aborted` so it isn't shown
as a failure — and (b) bumps `runIdRef`, so a response already on the wire is
dropped by the resolver instead of touching the document. The server-side model
call still completes and still costs a call; that's unavoidable without
streaming.

**Gotchas worth keeping**

- Preview updates are dispatched as **functions** of the current document
  (`edit((r) => setBullet(r, …))`), never objects built from the render closure,
  and `setResume` applies them against `resumeRef` synchronously. Two updates in
  one event (Enter inside a bullet: commit the text, then split the bullet) must
  compose — building both from render-time state loses the typed text.
- `EditableText` is uncontrolled *while focused*: the DOM text is only written
  from props when the node isn't focused, and changes commit on blur/Enter.
  Re-rendering a controlled `contentEditable` per keystroke resets the caret.
  Paste is flattened to plain text — no markup may enter the document.
- The fit-to-width scale measures the container's **border box** and reserves a
  fixed scrollbar width. Reading `clientWidth` there is a trap: it shrinks when
  the vertical scrollbar appears → scale changes → scaled height changes → the
  scrollbar toggles again, a ResizeObserver feedback loop. `.sheetScroll` also
  pins `overflow-y: scroll` so the gutter never moves.
- `.app-shell--wide` is bounded to `100vh` above 900px so the two panes scroll
  internally. **At or below 900px the panes become tabs**, not a stack:
  `useStackedLayout` watches the same breakpoint in JS and only the selected
  pane is rendered, because an 816px sheet under a full chat is unusable on a
  phone. Rendering the hidden pane instead would feed the ResizeObserver a
  zero width, so `measure()` bails on `width === 0` and keeps the last fit.
- Fullscreen is a real modal: `aria-modal`, focus moved in on open and returned
  to the opener on close, and Tab trapped inside. The Escape handler for the
  download menu is registered in the **capture** phase on `document` and stops
  propagation, so closing the menu can't also exit fullscreen; the fullscreen
  handler is on `window` in the bubble phase and therefore runs second.
- Empty `EditableText` fields carry a faint dashed rule so the sheet reads as
  fillable. It's scoped to `[contenteditable="true"]`, and the exporter sets
  every editable to `false` on the clone, so it can't reach a PDF or a raster.
- The resume sheet is deliberately the one place that ignores the theme tokens —
  it's paper, and must look the same on screen as in the PDF.
- Exports clone the sheet off-screen at its natural 816px width, strip
  `[data-noexport]` (all editing chrome) and remove `data-placeholder`
  attributes (the placeholders are CSS `content: attr(...)`, so dropping the
  attribute drops them). The live preview is never mutated.
- Bullets: the editable field is `display: block` inside the `<li>` so the list
  marker aligns to the first line of a wrapped bullet, and the remove button is
  absolutely positioned so a 20px button can't inflate every line box.

**Downloads** (`utils/resumeExport.js`, both libraries lazy-loaded like
`pdfjs-dist`): *PDF — print optimized* is laid out from the data with jsPDF's
text API, so it's real selectable vector text, ~5 kB, and ATS-parseable — the
one to actually send to an employer. *PDF — exact preview* is an html2canvas
raster of the sheet (~300 kB, pixel-identical, unselectable). Plus JPG, PNG and
plain text.

### Backend endpoint

- `POST /api/resume/chat` behind `requireApiToken` + `attachClientId` + a per-IP
  rate limit (`RESUME_RATE_LIMIT_MAX`, default 30/min). Runs in its own
  `resume` model-budget pool (`RESUME_MODEL_CONCURRENCY`) so resume chatter
  can't starve live interviews.
- Payload caps (`config.resume`) are sized so
  `maxHistoryMessages * maxMessageLength + maxResumeJsonLength` stays under the
  64kb `express.json` limit — `server/test/resume.test.js` asserts this.

## Career survey

An optional fifteen-question survey about the user's job search, offered once on
the dashboard and reachable afterwards from the account menu. Route: `/survey` →
`SurveyScreen`.

> **This data is not used by any AI feature.** Not interview questions, not
> feedback, not the resume builder, not job matching. It is collected now so it
> can be wired into personalization later, as its own piece of work. The whole
> feature lives client-side against Supabase; **nothing in `server/` knows the
> table exists**, so no prompt can reach it even by accident.
> `client/test/survey.test.js` greps `server/src` for any reference and fails if
> one appears — that tripwire is there so switching this on becomes a decision
> someone makes on purpose rather than a line that slips in.

### The table — `public.user_survey_responses`

Defined in `supabase/migrations/20260921120000_user_survey_responses.sql`, and
**it must be applied by hand** — there's no CLI wiring in this repo and nothing
runs migrations automatically. Supabase → SQL Editor → paste → Run (or
`supabase db push` if you have the project linked). See `supabase/README.md`.

One row per user: `user_id uuid primary key references auth.users(id) on delete
cascade`. A profile, not an event log — retaking the survey edits the same row.

| column | shape | question |
| --- | --- | --- |
| `status` | `'dismissed' \| 'completed'` | not a question — see the three states below |
| `career_stage` | enum text | Q1 career stage |
| `target_industry`, `target_industry_other` | enum text + text(120) | Q2 industry (+ "Other" free text) |
| `employment_status` | enum text | Q3 employment status |
| `timeline` | enum text | Q4 how soon |
| `job_search_challenges` | `text[]` | Q5 biggest challenges (multi) |
| `interview_nerves` | `text[]` | Q6 interview types that worry them (multi) |
| `target_role` | text(120) | Q7 target title |
| `years_experience` | enum text | Q8 years of experience |
| `education_level` | enum text | Q9 education |
| `resume_status` | enum text | Q10 resume situation |
| `company_targeting`, `target_companies` | enum text + text(600) | Q11 specific companies (+ the list) |
| `app_goals` | `text[]` | Q12 what matters in this app (multi) |
| `work_arrangement` | enum text | Q13 remote / hybrid / in-office |
| `salary_expectation`, `salary_opt_out` | text(120) + boolean | Q14 salary — see below |
| `coach_wish` | text(600) | Q15 free text |
| `completed_at`, `created_at`, `updated_at` | timestamptz | `updated_at` by trigger |

- **Every answer column is nullable**: each question is individually skippable,
  and a skipped one is NULL rather than an empty string. The three `text[]`
  columns are `not null default '{}'` instead, so "picked nothing" is an empty
  array.
- **Single-selects and multi-selects are constrained in SQL**, not just in the
  UI (`check (... in (...))` / `check (col <@ array[...])`). The client's option
  values must stay inside those constraints or Postgres rejects the row —
  `client/test/survey.test.js` reads the migration and asserts every option
  value and `char_length` cap matches.
- **`salary_opt_out` is its own column** so "prefer not to say" stays
  distinguishable from "skipped the question". Ticking it clears
  `salary_expectation`, so a row can't say both.
- **RLS is on, with four `auth.uid() = user_id` policies.** The anon key is
  public, so that is the *only* thing between one account's answers and
  another's. Unlike the rest of the app (whose `X-Client-Id` is an isolation
  token the server takes on faith — see "Security model"), this table is a real
  server-side boundary, because Supabase verifies the JWT.

### The flow

Three states, and the row is what distinguishes them:

| state | row | what the user sees |
| --- | --- | --- |
| `none` | no row | the dashboard banner — **the only state that prompts** |
| `dismissed` | row, `status='dismissed'` | nothing automatic; the account menu says "Finish career survey" |
| `completed` | row, `status='completed'` | nothing automatic; the menu says "Edit survey answers" |

- **Skipping writes a row.** "Skip for now" on the banner upserts an empty
  `dismissed` row, which is what stops the prompt coming back next session —
  and, because it's a row rather than localStorage, on the user's other devices
  too. It is not "never": the survey stays in the account menu.
- **Exiting partway keeps the answers.** "Save & exit" writes what's filled in
  so far as `dismissed`, and returning prefills from it. Exiting with *nothing*
  filled in writes no row at all — opening the form out of curiosity and backing
  out isn't a dismissal, so the banner survives it.
- `completed_at` is set on Submit and deliberately never cleared by a later
  partial save.
- **`AppWorkspace` owns the status** (`survey/useSurvey.js`) so the dashboard
  banner and the account menu share one fetch per sign-in.

### Client structure

- `survey/surveyQuestions.js` — the fifteen questions as data (id, `column`,
  `single|multi|text`, options, follow-up field, opt-out, caps). **The single
  source of truth**: the form renders from it and the row mapping is derived
  from it. Adding a question means adding it here *and* to the migration.
  `SURVEY_STEPS` still groups them into five named sections, but **the screen
  walks `SURVEY_QUESTIONS` — one question per screen**. The grouping survives
  only as each question's `section` label ("About you", "Preferences"), shown
  above the question so someone twelve screens in can tell where they are, and
  as the thing that keeps related questions adjacent.
- `survey/surveyMapping.js` — pure `answers ↔ row` conversion. Split out from
  `surveyApi.js` **so it can be tested**: `surveyApi.js` imports the Supabase
  client, which reads `import.meta.env` at load time and throws under plain
  node. It also drops any option value the question doesn't define, rather than
  letting one stale value in local state fail the whole save.
- `survey/surveyApi.js` — the only module that touches the table.
- `screens/SurveyScreen.jsx` — **one question per screen**, Next to advance,
  fifteen in all, with a progress bar and "Question n of 15". Notes worth
  keeping:
  - **The question is the `<h1>`.** There's one thing on the screen, so it
    should be what the page is about, and focus moves to it on every advance —
    otherwise a keyboard user is left on a Next button belonging to a question
    they can no longer see. The option group is `aria-labelledby` that heading,
    which is why there's no `<fieldset>`/`<legend>`: around a single group whose
    label is already the page heading, that's a second name for the same thing.
  - **The card is keyed on the question id**, so React rebuilds the controls
    rather than reusing one text input across two different questions and
    carrying a caret (and a half-finished IME composition) between them.
  - **`min-height` on the card** — heights swing between a two-line text field
    and a twelve-option grid, and without a floor the buttons jump up the page
    on every Next.
  - A **progress bar, not fifteen pips**: at fifteen the dots are too small to
    count, and the only question anyone has is how much is left.
  - Deliberately **not** a `<form>`: nothing is required, and Enter in a text
    field submitting would skip the user past a question they were mid-answer
    on. Next is always enabled — skipping *is* pressing it.
  - Single-selects **toggle off** when re-clicked, because otherwise a mis-click
    can't be undone on an all-optional survey.
- `components/SurveyBanner.jsx`, `components/AccountMenu.jsx`.

### AccountMenu

Sign out used to be a bare button in the old top header. It's now inside
`AccountMenu` — email, the survey item, Sign out — because the survey needed a
permanent home and this app has no settings screen. Disabled wholesale during a
live interview, for the same reason the nav is.

### Website ratings — the n8n follow-up email

A day after someone completes the survey, an **n8n** workflow emails them asking
to rate the site; clicking a star writes the rating back to Supabase. The app
itself has no part in this — no screen, no client code, no Express route — and
**no AI feature reads it**, exactly as for the survey it follows from.

Everything lives in `n8n/` (two importable workflow JSONs plus a setup README)
and `supabase/migrations/20260922090000_website_ratings.sql`:

- `website_ratings` — one row per user (`rating` 1–5, optional `comment`).
  Upserted, so re-clicking a different star corrects the first rather than
  adding a row.
- `rating_requests` — one invite per user, carrying the token that appears in
  the email link.
- `claim_rating_candidates()` / `record_website_rating()` — `security definer`,
  granted to **`service_role` only**. n8n holds that key; the browser's anon key
  cannot call either.

Both tables have RLS on with **no policies at all**. That's not an oversight —
they're service-role-only, and a readable `rating_requests` would hand out live
invite tokens.

Three decisions worth not undoing:

- **The claim and the read are one statement.** `claim_rating_candidates()`
  inserts each invite row in the same query that returns it, so a user it hands
  back is already claimed. Select-then-insert-later means a crash between the
  two, or two overlapping runs, emails somebody twice — and a duplicate "please
  rate us" is far worse than a missed one.
- **The link carries a token, not a user id.** A one-click rating URL is a
  credential; `?user_id=<uuid>&rating=5` would let anyone rate as anyone, and
  user ids aren't secret.
- **A bad token gets a sentence, not a 500.** `record_website_rating()` returns
  `(ok, message)` rather than raising, and the HTTP node sets `neverError`, so
  an expired link renders a readable page.

`n8n/README.md` has the setup, the test procedure, and the SQL for reading
results.

### Degrading when the migration hasn't been applied

Every entry point is gated on the feature being *available*, and a missing table
(PostgREST `PGRST205` / Postgres `42P01`) reads as "unavailable", not an error:
no banner, no menu item, and `/survey` — still reachable by URL — explains that
the table is missing instead of throwing. A failed read collapses the same way
on purpose: nobody came here to take a survey, and an error banner on the
dashboard about one is worse than the prompt quietly not appearing.

## Security model — read before deploying

Users sign in with Supabase, but **only the client enforces it** — the API has
no notion of a user account (see "Authentication" → "What this is not"). On the
server, two mechanisms stand in:

1. **`API_TOKEN`** (server env). When set, every `/api` route except
   `/api/health` requires `Authorization: Bearer <API_TOKEN>`. The client sends
   it from `VITE_API_TOKEN`. **Unset = the API is open to anyone who can reach
   the port.** Always set it for a non-local deployment. It is a single shared
   secret, and because it ships in the built client it is not a per-user secret —
   it just keeps the open internet out.

2. **`X-Client-Id`** — who owns saved interviews (`client/src/identity.js`).
   Signed in it is `u-<supabase user id>`; signed out it falls back to a random
   per-browser id in localStorage. Saved interviews are stamped with it
   (`ownerId`) and every history read/write/delete is scoped to it, so one owner
   can't list, open, or delete another's interviews. It's an isolation token,
   not authentication — the server takes the header at face value, same trust
   level as the unguessable session UUIDs.
   `assertOwner` **fails closed**: once a session has an owner, a request with a
   missing/malformed `X-Client-Id` is rejected (404), not waved through.

Other guards already in place:
- Per-IP sliding-window rate limit on `/api/interview` (`RATE_LIMIT_MAX`, default
  30/min), a looser one on `/api/interviews` and `/api/health`, and one on
  `/api/jobs` (`JOB_MATCH_RATE_LIMIT_MAX`, default 20/min).
- `modelBudget.js`: three independent concurrency pools —
  `MAX_CONCURRENT_MODEL_CALLS` for interviews, `JOB_MATCH_MODEL_CONCURRENCY` for
  Job Matches, `RESUME_MODEL_CONCURRENCY` for the Resume Builder — plus a global
  `MODEL_CALLS_PER_DAY` ceiling (**defaults to 5000**
  now, not off) so a burst or an abuser rotating IPs can't run an unbounded
  OpenRouter bill.
- `MAX_LIVE_SESSIONS` cap; `/start` returns 503 when full.
- `MAX_INTERVIEWS_PER_OWNER` cap; oldest are dropped.
- Per-session processing lock (`beginProcessing`) → concurrent/duplicate model
  calls for one session get a 409, not a corrupted transcript or double bill.
- Strict CSP (`default-src 'none'`), `X-Frame-Options: DENY`, nosniff,
  `Referrer-Policy: no-referrer`, COOP/CORP, `Permissions-Policy`. HSTS behind
  `FORCE_HTTPS=true`.
- CORS allowlist (`CLIENT_ORIGIN`); a disallowed browser origin gets no CORS
  headers (not a 500).
- `express.json({ limit: "64kb" })`; explicit length caps on job description
  (8000), answers (5000), interview resume paste (6000), and Job Matches resume
  text (20000). Speak-mode `delivery` is rebuilt from a five-key numeric
  allowlist and clamped (`config.delivery`), so the field can't be used to smuggle
  anything — media included — into a session.
- Request timeouts on both ends (client 60s, also 60s for Job Matches calls;
  server `OPENROUTER_TIMEOUT_MS` 30s).
- `trust proxy` is **loopback-only by default** — set `TRUST_PROXY` to match your
  real proxy layer or the rate limiter keys everyone to the proxy's IP.
- Debug route `GET /api/interview/:sessionId` is **off** unless
  `ENABLE_DEBUG_ROUTES=true`.

### Still outstanding / known limitations

- **Model:** `server/.env` currently uses a `:free` model. It works (plain-text
  fallback + one parse retry) but a paid model is more reliable for `/feedback`.
- **Prompt injection:** the job description and answers go into the LLM verbatim.
  A user can steer their own interview; there's no cross-user impact, but the
  model output is not to be trusted as safe HTML — the client only ever renders
  it as text, keep it that way. Same applies to resume text and to job
  titles/descriptions pulled from Adzuna in Job Matches, and to every field of
  the Resume Builder document (rendered as text nodes; paste into the preview is
  flattened to plain text, so no markup can enter the document either way).
  The career survey's free-text answers are the one batch of user input that
  reaches **no** model at all — keep it that way until wiring it in is a
  deliberate piece of work, and treat those fields as untrusted input the day it
  stops being true.
- **Job Matches on a `:free` model:** a full search still makes ~13 model calls
  (1 profile + up to 12 scoring), just spread across `/search` + several
  `/score` batches; the free OpenRouter tier's ~20/min limit will make some job
  scores come back `null` — the screen surfaces this and offers "Score
  remaining". A paid model fixes it. `openrouter.service` remembers when a model
  rejects JSON mode (time-boxed to 30 min, so a one-off misclassified 400
  doesn't disable JSON mode for the whole process).
- **Speak mode on a `:free` model** follows the delivery guidance only loosely. In
  testing it reliably picked the metrics up and kept scores content-based, but it
  recites the raw figures ("205 wpm, 7 pauses totalling 18s") despite being told
  to paraphrase, and it often skips the "suggest a concrete fix" instruction. A
  stronger model is the fix; tightening the prompt further mostly isn't worth it.
- **Speak mode is Chromium-only in practice.** The transcript comes from the Web
  Speech API, which Firefox doesn't ship — `ChatInput` already degrades to typing
  there, but that means Speak mode on Firefox measures delivery for an answer the
  candidate has to type. Consider hiding the mode where `supported` is false.
- **Eye contact is head orientation, not gaze.** Someone facing the camera while
  reading something off to the side scores as fully on-camera. Thresholds (25°
  yaw / 20° pitch) are deliberately loose; tightening them trades false negatives
  for false accusations, which is the worse error here.
- **Delivery metrics have no UI.** They reach the model and are stored on
  `qaPairs`, but nothing renders them, so a candidate can't check an AI claim
  about their pace against the number behind it. That was a deliberate scoping
  call, not an oversight — revisit it if delivery feedback starts feeling opaque.

## Storage — this is not production-durable

- **Live sessions:** in-memory `Map` in `session.service.js`. Lost on restart.
  1-hour inactivity TTL. The client mirrors an in-progress interview to
  `sessionStorage`, so a browser refresh resumes it *if* the server hasn't
  restarted.
- **Completed interviews:** a single JSON file, `<DATA_DIR>/interviews.json`
  (default `server/data/`), loaded into memory once, mutations serialized through
  a queue with atomic temp-file+rename writes. Set `DATA_DIR` to a mounted volume
  on hosts with an ephemeral filesystem, or the history vanishes on redeploy.
- **Single process only.** Sessions, the rate limiter, and the model budget are
  all in-process. Do not run more than one instance without swapping these for
  shared stores. `history.service.js` is deliberately isolated behind the same
  function signatures so it can be replaced with a DB module without touching
  controllers — that's the intended next step for a real deployment.
- **The one exception is the career survey**, which is a real Postgres table in
  Supabase, written from the client and protected by RLS. The Express server has
  no part in it. See "Career survey".

## Conventions

- **ESM everywhere**, `"type": "module"` in both packages.
- Server errors: throw an `Error` with `.status` and, if the message is safe to
  show the user, `.expose = true`. The central handler in `index.js` shows
  `expose` / 4xx messages and genericizes everything else. `openrouter.service.js`
  marks all its errors `expose`.
- Controllers validate and return `res.status(4xx).json({ error })` directly for
  input problems; they call `next(err)` for thrown/unexpected errors.
- The client `request()` wrapper normalizes every failure to an `Error` with an
  optional `.status` and a user-readable `.message`.
- Keep `client/src/constants.js` in sync with `server/src/config.js`: length
  limits (job description, answer, resume `MIN/MAX_RESUME_LENGTH`,
  `MAX_INTERVIEW_RESUME_LENGTH`), the question-count range, `INTERVIEW_FOCUSES` ↔
  `interviewFocuses`, `INTERVIEW_MODES` ↔ `interviewModes`, and
  `ADZUNA_COUNTRIES` ↔ `adzuna.supportedCountries`
  (`server/test/countrySync.test.js` guards the last one).
- CSS: see "Design system" above. Style through the tokens; no raw hex, font
  size, spacing or radius literal in module CSS. The resume sheet
  (`ResumePreview` / `EditableText`) is the one deliberate exception — it's
  paper, and must match the exported PDF.
- Feedback is normalized server-side (`normalizeFeedback` in
  `interview.controller.js`): scores clamped, per-question matched by
  `questionNumber`, skipped questions kept and scored 0.

## Gotchas

- **`[hidden]` loses to an explicit `display`.** `FeedbackReport`'s accordion
  bodies are `hidden={!isOpen}`, but `.qBody` sets `display: flex`, which beats
  the UA's `[hidden] { display: none }` — so for a while the accordion never
  collapsed at all: every answer stayed on screen and only `aria-expanded`
  moved. `.qBody[hidden] { display: none }` is what makes it work, and the
  `@media print` block deliberately overrides that back. Any module class used
  with the `hidden` attribute needs the same pairing.
- **`ChatInput` starts in the mode the candidate chose.** `preferType` is
  seeded from `!speakMode`. Before that, Type mode changed nothing about the
  composer — it still opened mic-first, said "tap the mic and speak", and showed
  the speech-provider disclosure to someone who had just chosen to write. The
  textarea auto-grows to `MAX_TEXTAREA_PX` and the remaining-characters counter
  only appears past 80% of `MAX_ANSWER_LENGTH`, because `maxLength` silently
  swallowing keystrokes reads as a broken keyboard.
- `interview.controller.js` evaluates **all asked questions**, not just answered
  ones — skipped questions appear in the report with score 0.
- In `ChatInput`, **Send is the primary button and Skip is a ghost**. They used
  to be one button whose label flipped to "Skip" when the box was empty, which
  made abandoning the question the loudest control on the screen. Keep them
  separate. The speech-provider disclosure is dismissible and remembered in
  localStorage (`mockInterview:voiceNoteSeen:v1`) — it used to sit under the
  composer permanently, two lines of grey text on every question.
- "End interview" confirms first. It scores or discards a part-finished
  interview, and it sits one click away in the status bar.
- `FeedbackReport`'s question breakdown is an accordion, defaulting to the
  weakest question open. The print stylesheet forces `[hidden]` bodies visible
  so printing a report prints all of it, not whatever happened to be expanded.
- `ChatScreen` countdown is driven off an absolute deadline that is stored on
  the question message (`deadlineAt`) and mirrored to sessionStorage, so a
  backgrounded tab — or a full page refresh — resumes the same countdown instead
  of getting a fresh full timer. If the deadline already passed while away, the
  answer auto-submits as timed-out.
- `useSpeechRecognition` restarts the engine across its idle timeout while the
  user wants to keep talking, with a hard 5-minute cap per recording. Speak mode
  reports recording state from an **effect on `listening`**, not from the click
  handlers, precisely so those internal restarts don't look like the candidate
  stopping and starting again.
- **The engine emits once more from `onend`, after `stop()`** — it folds in audio
  that was never finalised. `ChatInput` gates that flush behind
  `acceptTranscriptRef`: it's wanted when the user just stops the mic (the words
  are still theirs to edit), and must be dropped on send / skip / clear / the
  input locking, where it lands *after* the draft is cleared and re-fills the
  composer with the answer that was already sent — which then bleeds into the
  next question. Easy to miss when typing; constant once voice is the default way
  to answer.
- **The speech-detection noise floor adapts only from samples already classified
  as silence.** Letting a loud sample move it was wrong three separate ways, all
  of which shipped and were caught by `client/test/deliveryMetrics.test.js`: a
  long unbroken answer dragged the threshold up through the candidate's own voice
  until its tail read as silence; an answer starting the instant recording began
  left the floor initialised at speaking volume so the whole thing read as
  silence; and the few loud samples inside the hysteresis window ratcheted the
  floor up a notch on every word gap, until whole sentences counted as pauses.
  Those three regression tests are the reason the rule is what it is — don't
  "simplify" it back.
- React StrictMode double-invokes effects in dev — `feedbackStartedRef` /
  `savingIdRef` guard against duplicate `/feedback` and duplicate saves, and
  `useDeliveryCapture` guards `getUserMedia` with a pending-promise ref plus a
  generation counter, or the doubled effect opens two camera streams and leaks
  the first (camera light stays on, with nothing on screen explaining why).
- `POST /api/interviews` is idempotent per session (`session.savedInterviewId`).
  `AppWorkspace.jsx` re-fires this once on a reload that lands straight on the results
  screen, so a save that failed on a network blip still gets recorded.
- Job Matches PDF parsing is client-side only (`pdfjs-dist`, lazy-loaded, ~350 kB
  gzip in its own chunk). Scanned/image PDFs yield no text — the screen asks for
  a different file (there's no manual-paste fallback, by design — see below).
  The server never receives the file, only extracted text.
- **In Job Matches, resume text is never rendered in the UI** — not in a
  textarea, not anywhere. `JobMatchesScreen` keeps `resumeText` as internal-only
  state; the only visible trace after upload is a filename + character-count
  confirmation. Don't reintroduce an `<input>`/`<textarea>` bound to that state
  — that was a real bug once (extracted PDF text landing in an editable box),
  and there's no "paste your resume" fallback on that screen for the same
  reason: no field there may be pre-filled from file-extracted text.
  (`JobDescriptionScreen` *does* have an optional resume-paste box — that's fine:
  it's the user typing/pasting their own text, never populated from a file, and
  it's a different screen.)
- `jobs.service.js`'s Adzuna fetch has a 12s timeout and resolves to a result
  object (never throws) so an Adzuna outage surfaces as a `warning`, not a crash.
  `normalizeAdzunaJob` drops any listing whose `redirect_url` isn't a valid
  http(s) URL (`isHttpUrl`), so nothing but a real link reaches an `href`.
