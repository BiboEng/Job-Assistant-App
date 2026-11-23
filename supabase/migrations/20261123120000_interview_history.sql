-- Interview history: every completed mock interview, with its answers and
-- feedback. Replaces the server's flat file (<DATA_DIR>/interviews.json), which
-- a host without a persistent disk (Render's free plan) wiped on every deploy.
--
-- APPLY THIS BY HAND: Supabase → SQL Editor → paste → Run (or
-- `supabase db push`). No other migration needs to come first.
--
-- SERVER-ONLY, like user_subscriptions: RLS is on with NO policies, so the anon
-- key in the browser bundle can neither read nor write it. The API server reads
-- and writes it with the service-role key, scoped by `owner_id` — the owner the
-- server took from the caller's verified Supabase token. The server uses it
-- only when SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are both set; until this
-- table exists it falls back to the flat file and logs why.
--
-- See CLAUDE.md → "Storage".

create table if not exists public.interview_history (
  id uuid primary key default gen_random_uuid(),

  -- The server's owner id: `u-<user id without dashes>` for a signed-in user
  -- (the same string the flat file used, so imported history keeps its owner),
  -- or a browser id on a server running without sign-in verification.
  owner_id text not null
    check (char_length(owner_id) between 1 and 200),

  -- The Supabase account, when the owner is one. Deleting the account deletes
  -- its history. Null for a legacy browser-id owner.
  user_id uuid references auth.users (id) on delete cascade,

  created_at timestamptz not null default now(),

  job_description text not null
    check (char_length(job_description) <= 20000),

  mode text
    check (mode is null or mode in ('type', 'speak')),

  focus text
    check (focus is null or char_length(focus) <= 40),

  total_questions integer not null default 0
    check (total_questions between 0 and 50),

  -- [{ questionNumber, question, answer, timeLimitSeconds, delivery }]
  qa_pairs jsonb not null default '[]'::jsonb,

  -- The evaluator's normalized report (overallScore, summary, rubric, …).
  feedback jsonb not null default '{}'::jsonb,

  -- Progress's role label: { title, source, labelledAt }, or null until named.
  role jsonb
);

-- Every read is "this owner's interviews, newest first".
create index if not exists interview_history_owner_created_idx
  on public.interview_history (owner_id, created_at desc);

create index if not exists interview_history_user_idx
  on public.interview_history (user_id);

alter table public.interview_history enable row level security;

-- No policies on purpose: only the service role (the API server) gets in.
revoke all on table public.interview_history from anon, authenticated;
