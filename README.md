# Mock Interview App

AI-powered mock interview practice. Paste a job description, answer 3 tailored
interview questions in a chat, then get scored feedback.

- **Frontend:** React + Vite, plain CSS Modules
- **Backend:** Node.js + Express (ESM)
- **AI:** OpenRouter (called only from the backend)

## Structure

```
mock-interview/
├── server/   Express API + OpenRouter integration + in-memory sessions
└── client/   React (Vite) UI: job description -> chat -> results
```

## Setup

### 1. Backend

```bash
cd server
npm install
cp .env.example .env      # then edit .env and add your OpenRouter key
npm run dev
```

`.env` (see `server/.env.example` for the full list):

```
OPENROUTER_API_KEY=sk-or-...          # required
OPENROUTER_MODEL=openai/gpt-4o-mini   # optional, overrides the default in src/config.js
PORT=3001                             # optional
API_TOKEN=long-random-string          # optional locally, REQUIRED for any real deployment
CLIENT_ORIGIN=https://app.example.com # optional, extra CORS origin(s), comma-separated
TRUST_PROXY=1                         # optional, set to match your proxy layer
FORCE_HTTPS=true                      # optional, send HSTS (HTTPS only)
RATE_LIMIT_MAX=30                     # optional, per-IP requests/min on interview routes
OPENROUTER_TIMEOUT_MS=30000           # optional, upstream call timeout
DATA_DIR=/var/data/mock-interview     # optional, history location (use a volume in prod)
```

**Access control.** With no `API_TOKEN` the API is open to anyone who can reach
it — fine on `localhost`, not fine deployed. When set, all `/api` routes except
`/api/health` need `Authorization: Bearer <API_TOKEN>`; the client reads it from
`VITE_API_TOKEN`. Saved history is additionally scoped per browser via an
`X-Client-Id` header the client generates, so one browser can't see or delete
another's interviews.

To try a different model, either edit `OPENROUTER_MODEL` in `.env` or change
`MODEL` in `server/src/config.js`. Prefer a paid model — `:free` models are
rate limited and may not support JSON output, which the app falls back around
but slower and less reliably.

**Keep `OPENROUTER_API_KEY` secret.** If it's ever exposed (commit, screenshot,
shared folder), rotate it at https://openrouter.ai/keys.

### 2. Frontend

```bash
cd client
npm install
npm run dev
```

Vite serves on http://localhost:5173 and proxies `/api` to the backend on 3001,
so no CORS setup is needed in development.

### Run both at once (optional)

From the repo root:

```bash
npm install
npm run dev
```

## API

| Method | Path                                | Purpose                                  |
|--------|-------------------------------------|------------------------------------------|
| POST   | `/api/interview/start`              | Create session from a job description    |
| POST   | `/api/interview/:sessionId/answer`  | Submit an answer, get the next question  |
| POST   | `/api/interview/:sessionId/feedback`| Generate final scoring                   |
| GET    | `/api/interview/:sessionId`         | Inspect session state (debug; off unless `ENABLE_DEBUG_ROUTES=true`) |
| GET    | `/api/interviews`                   | List saved interviews (home screen)      |
| GET    | `/api/interviews/:id`               | One saved interview's full detail        |
| POST   | `/api/interviews`                   | Save a completed session `{ sessionId }` |
| DELETE | `/api/interviews/:id`               | Delete a saved interview                 |
| GET    | `/api/health`                       | Health check                             |

Each question comes with a `timeLimitSeconds` (60–300, estimated server-side from
the question text in `src/timeLimit.js`). The chat screen counts it down and
auto-submits whatever's typed when it hits zero; an empty auto-submit skips that
question. Answers may be posted with `{ answer, timedOut: true }` to allow an
empty body.

Live sessions live in memory only and are lost on server restart. The client
mirrors an in-progress interview to `sessionStorage`, so a browser refresh
resumes where you left off (as long as the server hasn't restarted and the
1-hour session TTL hasn't elapsed).

**Completed** interviews are persisted to `<DATA_DIR>/interviews.json` (a flat
JSON file, gitignored, auto-created; default `server/data/`) and shown on the
home screen, scoped to the saving browser. Each record holds the job
description, timestamp, questions, answers, and feedback. The client saves
automatically once feedback is generated and surfaces a retry if that fails.
Swap `history.service.js` for a DB-backed module later without touching the
controllers.

This store is process-local and not durable on an ephemeral filesystem — point
`DATA_DIR` at a mounted volume, and don't run more than one instance (sessions,
rate limiter, and model budget are all in-process).

Guards in place: optional bearer-token auth + per-browser history scoping, per-IP
sliding-window rate limiting, a process-wide model-call concurrency/day budget,
caps on live sessions and stored interviews, request-size and input-length caps,
per-session locking so concurrent/duplicate requests can't corrupt a transcript
or double-bill a model call, a strict CSP and the usual security headers, and
upstream timeouts on both client and server.

Run `cd server && npm test` for the unit tests.
