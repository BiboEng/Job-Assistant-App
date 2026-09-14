# Mock Interview App — working notes for Claude

AI-powered mock interview practice. Paste a job description, pick a question
count (2–6) and a focus (mixed / behavioral / technical / system-design), and
optionally paste your resume → answer the tailored questions in a chat (voice or
text) → get scored feedback. Completed interviews are saved to a per-browser
history.

A second feature, **Job Matches**, takes a resume + a city and returns real open
roles from Adzuna — searched broadly across all companies and roles, not
restricted to any particular employer — each scored against the resume by the
model. See "Job Matches" below.

A third feature, **Resume Builder**, is a split screen: chat on the left, a live
ATS-friendly resume on the right. Both the AI and the user's own inline edits
write to one shared document. See "Resume Builder" below.

- **Frontend:** React 18 + Vite, plain CSS Modules over a design-token layer in
  `index.css`. No component library, no router, no state library — `App.jsx`
  owns navigation via a `screen` string, and `AppHeader` carries a persistent
  nav so no feature is reachable only from Home. See "Design system" below.
- **Backend:** Node.js + Express (ESM). No database — see "Storage" below.
- **AI:** OpenRouter chat completions, called **only** from the backend.

## Layout

```
mock-interview/
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
        ├── App.jsx                  screen state machine + sessionStorage mirror
        ├── index.css                design tokens, theme blocks, shared button/banner/skeleton classes
        ├── identity.js              per-browser client id (localStorage) → X-Client-Id
        ├── constants.js             limits + timeout; keep in sync with server config.js
        ├── api/                     client.js (fetch wrapper) + one module per resource (jobsApi, resumeApi, …)
        ├── screens/                 Home (landing + history), JobDescription (JD + options), Chat, Results, HistoryDetail, JobMatches, ResumeBuilder
        ├── components/              AppHeader (nav), ChatInput (voice/text), ChatMessage, FeedbackReport,
        │                            JobCard, ResumePreview, ResumeChatPanel, EditableText, and the shared
        │                            primitives: Icon, ThemeToggle, SegmentedControl, Toast
        ├── utils/theme.js           light/dark/system preference → data-theme + meta theme-color
        ├── utils/score.js           score → { color, soft, label } band, shared by every score chip
        ├── utils/parseResume.js     client-side PDF/text → resume text (lazy-loads pdfjs-dist)
        ├── utils/resumeModel.js     resume doc shape + immutable edit helpers
        ├── utils/resumeExport.js    PDF / print-PDF / JPG / PNG / TXT (lazy html2canvas + jsPDF)
        └── hooks/useSpeechRecognition.js   Web Speech API wrapper, client-only
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
- Client env: `client/.env` is optional; only needed to set `VITE_API_BASE_URL`
  (no proxy) or `VITE_API_TOKEN` (server has `API_TOKEN` set).
- Tests: `cd server && npm test`. There is no client test runner yet.

## Design system

`client/src/index.css` is the single source of visual truth. Module CSS styles
**through the tokens** — no raw hex, font size, spacing value or radius belongs
in a `*.module.css` file. If a value is missing, add it to `index.css`.

- **Scales:** `--fs-2xs … --fs-4xl` (type), `--sp-1 … --sp-10` (spacing),
  `--radius-xs/sm/md/lg/xl/pill`, `--shadow-xs/sm/md/lg`. `--radius` and
  `--shadow` remain as aliases for the older `-md` values.
- **Color:** neutrals (`--bg`, `--surface`, `--surface-sunken`,
  `--surface-hover`, `--border`, `--border-strong`, `--text`, `--text-muted`,
  `--text-subtle`), accent (`--accent`, `--accent-hover`, `--accent-soft`,
  `--accent-softer`, `--accent-ring`, `--gradient-accent`), and semantics
  (`--success`, `--warn`, `--danger`, each with `-soft`/`-border`). Score bands
  keep their own names (`--band-strong/mixed/weak` plus `-soft`) because
  `utils/score.js` applies them through inline styles as well as from CSS.
  **A warning is amber** — use `.warn-banner`, never the accent, which is what
  Job Matches used to do for Adzuna failures and unscored roles.
- **Theming is three-state.** "System" sets no attribute and lets
  `prefers-color-scheme` decide; an explicit choice stamps
  `data-theme="light"|"dark"` on `<html>`. So every dark value is declared
  twice: under `@media (prefers-color-scheme: dark)` guarded by
  `:root:not([data-theme="light"])`, and again under `:root[data-theme="dark"]`.
  Add a token to **both** blocks or the toggle silently half-works.
  `utils/theme.js` owns the preference; an inline script in `index.html` applies
  it before first paint (keep the storage key in step between the two).
- **Shared classes** in `index.css`: `.btn-primary`, `.btn-ghost`, `.btn-subtle`,
  `.btn-danger`, `.btn-sm`, `.link-btn`, `.card`, `.error-banner`,
  `.warn-banner`, `.info-banner`, `.skeleton`, `.eyebrow`, `.sr-only`,
  `.no-print`. These are global, so a CSS module **cannot** target them —
  `.controls > .btn-primary` in a module compiles to a hashed selector that
  matches nothing. Add a module class to the element instead.
- **Icons** are `components/Icon.jsx` — one inline-SVG sprite in `currentColor`,
  decorative (`aria-hidden`) unless given a `title`. No emoji in the chrome:
  emoji render at a different weight, size and color on every platform.
- **Screen transitions:** `App.jsx` renders each screen into a keyed
  `.screen-slot.screen-enter` wrapper. The slot must stay a growing flex column
  — ChatScreen and ResumeBuilderScreen depend on `flex: 1; min-height: 0` to
  scroll internally instead of growing the page. The enter animation ends on
  `transform: none` so it leaves no containing block behind for the Resume
  Builder's fixed-position fullscreen layer.
- **Reduced motion** is handled once, globally. Don't re-implement it per module
  beyond disabling an animation that still reads wrong when frozen.

## Job Matches

Reached from the Home screen ("Find job matches"). Screen: `JobMatchesScreen`
(`App.jsx` `screen === "jobMatches"`).

The flow is **two-phase** so results show immediately and scores fill in
progressively instead of one ~1-minute blocking request. The result is cached in
`App.jsx` state (`jobsResult`), so leaving the screen and returning doesn't
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
4. While scoring, cards hold Adzuna's relevance order (no jumping) and no
   filter is offered — sorting or filtering mid-stream would make cards jump as
   scores land. Once `status === "done"` the user can sort by best match or most
   recent and filter by score floor, posted window, "has salary" and "remote".
   **Those filters are client-side, over what already came back** — the Adzuna
   query itself is city-scoped server-side, so "remote" matches on the returned
   title/location text rather than re-running the search. `JobCard` renders company,
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

Reached from the Home screen ("Build a resume"). Screen: `ResumeBuilderScreen`
(`App.jsx` `screen === "resume"`). Session-only — nothing is persisted, by
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
  it's paper, and must look the same on screen as in the PDF in either theme.
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

## Security model — read before deploying

The app has **no user accounts**. Two mechanisms stand in:

1. **`API_TOKEN`** (server env). When set, every `/api` route except
   `/api/health` requires `Authorization: Bearer <API_TOKEN>`. The client sends
   it from `VITE_API_TOKEN`. **Unset = the API is open to anyone who can reach
   the port.** Always set it for a non-local deployment. It is a single shared
   secret, and because it ships in the built client it is not a per-user secret —
   it just keeps the open internet out.

2. **`X-Client-Id`** — a random id the browser generates and stores in
   localStorage (`client/src/identity.js`). Saved interviews are stamped with it
   (`ownerId`) and every history read/write/delete is scoped to it, so one
   browser can't list, open, or delete another's interviews. It's an isolation
   token, not authentication — same trust level as the unguessable session UUIDs.
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
  text (20000).
- Request timeouts on both ends (client 60s, also 60s for Job Matches calls;
  server `OPENROUTER_TIMEOUT_MS` 30s).
- `trust proxy` is **loopback-only by default** — set `TRUST_PROXY` to match your
  real proxy layer or the rate limiter keys everyone to the proxy's IP.
- Debug route `GET /api/interview/:sessionId` is **off** unless
  `ENABLE_DEBUG_ROUTES=true`.

### Still outstanding / known limitations

- **Rotate the OpenRouter key.** The key in `server/.env` was exposed; it must be
  rotated at https://openrouter.ai/keys. (The assistant cannot edit `server/.env`.)
- **Model:** `server/.env` currently uses a `:free` model. It works (plain-text
  fallback + one parse retry) but a paid model is more reliable for `/feedback`.
- **Prompt injection:** the job description and answers go into the LLM verbatim.
  A user can steer their own interview; there's no cross-user impact, but the
  model output is not to be trusted as safe HTML — the client only ever renders
  it as text, keep it that way. Same applies to resume text and to job
  titles/descriptions pulled from Adzuna in Job Matches, and to every field of
  the Resume Builder document (rendered as text nodes; paste into the preview is
  flattened to plain text, so no markup can enter the document either way).
- **Job Matches on a `:free` model:** a full search still makes ~13 model calls
  (1 profile + up to 12 scoring), just spread across `/search` + several
  `/score` batches; the free OpenRouter tier's ~20/min limit will make some job
  scores come back `null` — the screen surfaces this and offers "Score
  remaining". A paid model fixes it. `openrouter.service` remembers when a model
  rejects JSON mode (time-boxed to 30 min, so a one-off misclassified 400
  doesn't disable JSON mode for the whole process).

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
  `interviewFocuses`, and `ADZUNA_COUNTRIES` ↔ `adzuna.supportedCountries`
  (`server/test/countrySync.test.js` guards the last one).
- CSS: see "Design system" above. Style through the tokens; no raw hex, font
  size, spacing or radius literal in module CSS. The resume sheet
  (`ResumePreview` / `EditableText`) is the one deliberate exception — it's
  paper, and must match the exported PDF in either theme.
- Feedback is normalized server-side (`normalizeFeedback` in
  `interview.controller.js`): scores clamped, per-question matched by
  `questionNumber`, skipped questions kept and scored 0.

## Gotchas

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
  user wants to keep talking, with a hard 5-minute cap per recording.
- React StrictMode double-invokes effects in dev — `feedbackStartedRef` /
  `savingIdRef` guard against duplicate `/feedback` and duplicate saves.
- `POST /api/interviews` is idempotent per session (`session.savedInterviewId`).
  `App.jsx` re-fires this once on a reload that lands straight on the results
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
