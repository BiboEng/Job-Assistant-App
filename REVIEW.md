# Jobassist — full app review (2026-09-27)

Status (later on 2026-09-27): all High items plus M1, M2, M4, M5, M10 and M12
are fixed in the working tree (uncommitted); L6 and L16 were fixed alongside.
M3, M6-M9, M11 and the other Low items are still open.

Scope: every file in `server/src`, `client/src`, `supabase/`, `n8n/`, plus the
docs. Nothing was changed except this file (untracked, not committed).

Baseline health: `server` tests 95/95 pass, `client` tests 52/52 pass,
`vite build` is clean. No lint step, no CI.

Severity key: **High** = user-visible bug, data loss or a real security gap ·
**Medium** = wrong behaviour in a plausible case, or misleading copy ·
**Low** = polish, cleanup, docs.

---

## High

### H1. Timed-out answer + any request failure = infinite retry loop — FIXED
`client/src/screens/ChatScreen.jsx:156-166, 224-234`

When the countdown hits 0 the answer auto-submits with `timedOut: true`. If that
request fails, the catch block rolls back the message and sets
`autoSentForRef.current = null` ("let the restarted timer retry"). `busy` flips
back to false → `awaitingAnswer` becomes true → the countdown effect re-runs,
the deadline is already past, so `secondsLeft` goes `null → 0` → the auto-submit
effect fires again immediately. No backoff, no cap.

With a persistent error (session expired after a server restart → 404, daily
model cap → 503, rate limited → 429) the tab hammers the API as fast as the
round-trip allows, forever. Because the server's rate limiter also counts
rejected hits (see M9), that user then stays locked out.

Fix: cap auto-retries (e.g. one) and/or only retry on retryable statuses; stop
on 404 and show the existing "Start over" path.

### H2. A failed "next question" call corrupts the interview transcript — FIXED
`server/src/controllers/interview.controller.js:125-141`,
`server/src/services/session.service.js:156-168`

`submitAnswer` calls `recordAnswer()` (pushes the user turn onto
`session.messages`) *before* the model call. If the model call fails (429/504
from a `:free` model, 503 pool busy — all common), the answer stays recorded but
the client rolls back and re-sends. The retry appends the same answer again, so
the interviewer model sees two consecutive user turns, and with H1 it can be
N copies of "(No answer — the candidate ran out of time.)".

It also loses Speak-mode data: the client's `collect()` has already reset the
delivery tracker, so the retry sends `delivery: null` and overwrites the
metrics recorded on the first attempt.

Fix: roll the session back on failure (pop the message, restore
`answer`/`delivery`), or make the answer write idempotent (if the last message
is already a user turn for this question, replace it). On the client, keep the
collected `delivery` and re-send it on retry.

### H3. The browser Back button silently throws away a Resume Builder document — FIXED
`client/src/screens/ResumeBuilderScreen.jsx` (leave guard + `beforeunload`),
`CLAUDE.md:729`

The docs say `beforeunload` "covers reload, tab close and the browser's own
Back button". It doesn't cover Back. Going from `/resume` back to `/dashboard`
is a `popstate` inside the SPA. The document never unloads, so `beforeunload`
never fires, and the resume and chat are gone with no prompt. The document only
lives in component state, so this is the likeliest way anyone loses one.

Fix: autosave the draft to `localStorage`/`sessionStorage` and restore it on
mount (simplest, and it also survives crashes). Or move to a data router and
use `useBlocker`. Either way, correct the doc.

### H4. Model returning a partial resume wipes the rest of the document — FIXED
`server/src/services/resume.service.js:354-375`

`interpretModelTurn` accepts a "bare resume" when *any* section key is present,
then `normalizeResume` fills every missing section with empty values. A small
model that returns only the section it touched, e.g. `{ "experience": [...] }`,
therefore erases contact, summary, skills, etc. Undo can recover it, but only
if the user notices.

Fix: merge over the current document. Take a section from the model only when
the key is present; keep the client's copy otherwise.

### H5. The API still trusts a client-supplied owner id now that real accounts exist — FIXED
`server/src/middleware/auth.js:179-183`, `client/src/identity.js`

This is documented as a known limitation. It's worth ranking it first for any
deployment, because the fix is now cheap: the client already holds a Supabase
access token. Today:
- anyone who learns a user's Supabase UUID can read and delete that user's
  history via `X-Client-Id: u-<uuid>`;
- `API_TOKEN` ships in the JS bundle, so a deployed API is effectively public.
  `/api/resume/chat` and `/api/jobs/score` then work as a general LLM proxy on
  your OpenRouter key;
- the only spend control is per-IP plus a **global** `MODEL_CALLS_PER_DAY`, so
  one abuser can burn the whole day's budget for every user.

Fix: send `Authorization: Bearer <supabase access_token>`, verify it server-side
(JWKS or the JWT secret), and take `ownerId` from `sub`. Then add per-user quotas
on top of the per-IP limit. `API_TOKEN` can be retired.

---

## Medium

### M1. Privacy copy claims things that aren't true — FIXED
- `JobDescriptionScreen.jsx:245-247`: "nothing is recorded or sent anywhere" and
  `ChatInput.jsx:353`: "that part is never sent anywhere". The five delivery
  numbers *are* sent to the server, stored on the session and passed to the AI
  evaluator. The raw audio and video are what never leave the browser. The
  first banner also reads as covering the whole Speak mode, but the transcript
  audio goes to Google (CLAUDE.md explicitly warns against this wording).
- `JobMatchesScreen.jsx:468`: "It is never shown on screen or saved." The resume
  text is saved in `localStorage` for 7 days, and it's sent to the server and
  OpenRouter.

Suggested wording: "Your camera and microphone audio never leave this browser;
only a few summary numbers (pace, pauses, % facing the camera) are sent with
your answer."

### M2. Docs say delivery metrics are saved in history. They aren't, and neither are mode or focus — FIXED
`server/src/services/history.service.js:237-242`, `CLAUDE.md:575`

`saveInterview` rebuilds each `qaPair` from four fields and drops `delivery`.
The record also has no `mode` or `focus`, so the history detail page can't show
"spoken" / "typed" or the focus, even though the results screen does. Either
persist `delivery`/`mode`/`focus` (probably wanted) or fix the doc.

### M3. Anonymous-era history is orphaned
`identity.js`, `AuthProvider.jsx:22-38`

Every app route now needs sign-in, and the owner id switched from the random
browser id to `u-<uuid>`. Interviews saved under the old browser id (the one
record in `server/data/interviews.json` is one) are invisible after sign-in, and
sign-out calls `resetBrowserId()`, which forgets the id for good. Consider a
one-time "claim" on first sign-in (send both ids; the server re-owns records
from the browser id). Otherwise the browser-id fallback is mostly dead code.

### M4. Leaving Job Matches mid-scoring throws away the whole search — FIXED
`JobMatchesScreen.jsx:182, 298, 376-382`

The result is only cached (workspace state + sessionStorage) once
`status === "done"`. Unmounting bumps `runIdRef`, so the loop bails and never
gets there, and `persistResult(null)` already ran at search start. Switch to
another sidebar item while scores are filling in and, on return, the search and
every model call already spent are gone. Cache after each batch instead, and
resume scoring on return.

### M5. One-click rating links will be "clicked" by email security scanners — FIXED
`n8n/capture-rating.json` (GET `/rate?token=…&rating=n` writes the rating)

Outlook Safe Links, Mimecast, Proofpoint and similar prefetch every link in an
email. Each star link is a state-changing GET, so a scanner can record a rating
(whichever star it fetched last) without the user touching it. Make the GET
render a confirm page that POSTs (or auto-submits via JS, which scanners don't
run).

### M6. The evaluator prompt makes the model echo every question and full answer back
`server/src/prompts/index.js:99-107`

`perQuestion[].question` and `.answer` are requested, then ignored:
`normalizeFeedback` uses the session's own copy. With 6 answers × up to 5,000
chars, that's thousands of wasted output tokens per report. It also raises the
odds that a `:free` model truncates mid-JSON, which is the known `/feedback`
flakiness. Drop both fields from the schema. While there, `overallScore` has no
stated relation to the per-question scores; either instruct it or derive it.

### M7. Model-call pools reject instead of queueing
`server/src/services/modelBudget.js:259-264`

A full pool is an immediate 503. `jobs` has 4 slots and one `/jobs/score` batch
uses all 4, so two users scoring at once get `null` scores and "rate limited"
messaging (which is also a guess; see L6). Progress has 2 slots shared by
labelling and themes, and a 503 there triggers the 5-minute labelling back-off.
A short bounded wait queue (e.g. up to 10s) would remove most of these.

### M8. Upstream response bodies aren't covered by the timeout
`server/src/services/openrouter.service.js:36-58, 78`, and `client/src/api/client.js:257-264`

The abort timer is cleared as soon as headers arrive, but `res.json()` /
`res.text()` read the body afterwards. A stalled upstream body hangs the request
indefinitely, and on the interview routes it also holds the session's
`processing` lock (every later call gets 409) and a pool slot. Keep the
timer alive until the body has been read.

### M9. The rate limiter counts rejected requests
`server/src/middleware/rateLimit.js:236-248`

Hits are recorded before the limit check, so a client that keeps retrying while
limited never falls back under the window (compounded by H1). Record only
allowed requests, or at least stop pushing once over the limit (the array also
grows without bound under a flood).

### M10. The processing lock can be released by someone else's request — FIXED
`interview.controller.js:153-155, 222-224`

The outer `catch` calls `endProcessing(session)` for any error, including
`assertOwner` throwing *before* this request took the lock. A request with a
wrong or missing `X-Client-Id` therefore clears the lock held by the real
owner's in-flight call, letting a duplicate through. Only release the lock in
the path that acquired it (the inner `finally` already does).

### M11. Duplicate history records on concurrent saves
`interviews.controller.js:62-74`

`savedInterviewId` is set only after `await saveInterview()`. Two concurrent
`POST /api/interviews` calls for one session (a reload re-fire overlapping the
original, two tabs) both pass the idempotency check. Store an in-flight promise
on the session and return it to the second caller.

### M12. The "print-optimized" resume PDF only handles Latin text and US Letter — FIXED
`client/src/utils/resumeExport.js:40, 195+`

It uses jsPDF's built-in Helvetica (WinAnsi), so Arabic, CJK, Cyrillic and many
accented names come out as garbage in the PDF the app tells people to send to
employers. The page size is always US Letter, but Job Matches serves 19
countries, most of them A4. Embed a Unicode TTF (e.g. Noto Sans) and offer
A4/Letter. Links are also plain text; `textWithLink` would make
LinkedIn/portfolio URLs clickable.

---

## Low

### Correctness / robustness
- **L1.** `jobs.service.js:511-530`: if the AND (`what`) Adzuna request *throws*
  (5xx/timeout), the OR fallback is never tried; the whole search fails. Catch
  per attempt.
- **L2.** Stale listings are only badged client-side; Adzuna supports
  `max_days_old`, which would stop 13-month-old roles from being fetched (and
  scored with model calls) at all.
- **L3.** `history.service.js:246-250`: `cache.push` happens before `persist()`.
  If the write fails, memory and disk diverge, and the client's retry adds a
  second in-memory copy.
- **L4.** `parseResume.js:185`: all text items on a page are joined with spaces,
  so line structure is lost (use `item.hasEOL`); `doc.destroy()` is never called,
  so the worker keeps the document.
- **L5.** `roleLabel.js` seniority stripping: "Tech Lead" → key `tech`,
  "Level Designer" → `designer`, "Staff Accountant" → `accountant`. Edge cases,
  but they merge unrelated roles in Progress.
- **L6.** `JobMatchesScreen.jsx:~756`: unscored roles always say "(the AI service
  was rate limited)", which is often not the cause (pool 503, parse failure).
- **L7.** `ProgressScreen.jsx` role tabs: selection follows focus, so arrowing
  through the list fires a themes model call per role passed (cached after, but
  still spend). Debounce, or select on Enter.
- **L8.** `REQUEST_TIMEOUT_MS` (60s) equals the server's worst case for
  `/feedback` (two 30s attempts), so the client can time out just as the server
  succeeds. The retry then returns the cached result, but the user saw an
  error first. Give it ~75s.
- **L9.** Speech recognition language is fixed to `<html lang="en">`. Non-English
  answers transcribe poorly and there's no picker.
- **L10.** Single top-level `ErrorBoundary`: any render error blanks the sidebar
  too, and "Reload and start over" clears the live interview mirror. A
  per-route boundary inside `AppWorkspace` would contain it.

### Security hygiene
- **L11.** `npm audit` (client): `jspdf@2.5.2` pulls vulnerable `dompurify` (only
  used by `jspdf.html()`, which isn't called here, so low real exposure).
  `canvas`/`tar` come via pdfjs's optional Node deps, not in the browser.
  Server: `express 4.22` → `qs` moderate. Worth a routine bump
  (`jspdf` 3.x/4.x is a breaking change; test the exporter).
- **L12.** MediaPipe WASM + model load from jsdelivr/Google at runtime with no
  integrity check. Self-hosting them in `client/public/` (already anticipated in
  `faceTracker.js`) removes the third-party runtime dependency.
- **L13.** The client has no CSP/security headers (the API's CSP doesn't cover
  the static host). Add them in the hosting config when deploying.
- **L14.** `touch_user_applications()` / `touch_website_ratings()` have no
  `set search_path` (Supabase's linter flags "function_search_path_mutable").
- **L15.** `/api/health` publicly returns the model name. Harmless, but
  unnecessary.
- **L16.** Express JSON parse errors (malformed body) are 4xx and echo the raw
  parser message to the client.

### Docs / cleanup
- **L17.** `README.md` is from the first version: "Mock Interview App", "answer
  3 questions", no Supabase/auth, Job Matches, Resume Builder, Progress,
  Tracker, survey or n8n. It says history is "scoped per browser". Needs a
  rewrite (it's the first thing a visitor reads).
- **L18.** `resume.service.js:19-21` refers to `resumeSync.test.js` ("not
  possible") and a `resumeModel.test.js` that doesn't exist. A sync test is
  possible, the same way `countrySync.test.js` reads the client constants, so
  `RESUME_LIMITS` client↔server drift is currently unguarded.
- **L19.** `DashboardRoute` passes `onFindJobs` / `onBuildResume`, which
  `HomeScreen` no longer accepts.
- **L20.** History detail: the page `<h1>` and the report heading both say
  "Interview review", and the role title isn't shown (the Results screen does
  show it).
- **L21.** `server/data/interviews.json.corrupt-1788389978755` is sitting in the
  data dir. Worth checking what corrupted it. The Windows `rename` over an
  open file (antivirus or indexer holding it) is a known source of failed
  atomic writes.
- **L22.** No ESLint despite several `eslint-disable` comments
  (`react-hooks/exhaustive-deps`), and no CI running the two test suites.
  Adding both is cheap and would have caught some of the above.
- **L23.** Untracked `.agents/` and `skills-lock.json` in the repo root: either
  commit them deliberately or add them to `.gitignore`.

---

## Suggested order of work
1. H1 + H2 together (same flow, same fix session), with a regression test for
   the rollback.
2. H3 (autosave the resume draft) and H4 (merge partial model output).
3. M1 copy fixes: small, and it's a trust issue.
4. H5 before any public deployment.
5. M2–M12 as convenient; Low items opportunistically.
