-- Application Tracker: one row per job application, many per signed-in user.
--
-- APPLY THIS BY HAND before the tracker works: Supabase → SQL Editor → paste →
-- Run (or `supabase db push` if you use the CLI). Until it exists the client
-- treats the feature as switched off — the Applications screen explains that
-- the table is missing, and Job Matches hides its "Track this" button.
--
-- Written and read from the browser only, like the career survey: nothing in
-- server/ knows this table exists, and no AI prompt reads it. It is a
-- standalone tracker — not linked to mock interviews or Progress. See
-- CLAUDE.md → "Application Tracker".
--
-- Unlike user_survey_responses (a profile: one row per user), this is a list,
-- so rows get their own uuid and user_id is an ordinary indexed column.

create table if not exists public.user_applications (
  id uuid primary key default gen_random_uuid(),

  -- Defaults to the caller, and the insert policy below requires it to BE the
  -- caller, so a client can neither forget it nor forge someone else's.
  user_id uuid not null default auth.uid()
    references auth.users (id) on delete cascade,

  company text not null
    check (char_length(company) between 1 and 120),

  job_title text not null
    check (char_length(job_title) between 1 and 160),

  -- Rendered as an href, so only http(s) gets in. Null when there's no link.
  posting_url text
    check (posting_url is null or (char_length(posting_url) <= 2048 and posting_url ~* '^https?://')),

  -- Five values for four board columns: "Accepted / Rejected" holds both, so
  -- each card still records which way it went.
  stage text not null default 'saved'
    check (stage in ('saved', 'applied', 'interviewing', 'accepted', 'rejected')),

  notes text not null default ''
    check (char_length(notes) <= 4000),

  -- The application date. A plain date: nobody tracks the minute they applied.
  applied_on date,

  -- Optional interview date/time. When set, the card shows it prominently.
  -- No reminder is sent — this is only a visual flag.
  interview_at timestamptz,

  -- Where the card came from. 'job_matches' rows carry the listing's id (e.g.
  -- "adzuna:4812…") so the same listing can't be tracked twice.
  source text not null default 'manual'
    check (source in ('manual', 'job_matches')),
  source_job_id text
    check (char_length(source_job_id) <= 300),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.user_applications is
  'Application Tracker cards. Written from the browser under RLS; not read by any AI prompt or by the API server.';

create index if not exists user_applications_user_updated
  on public.user_applications (user_id, updated_at desc);

-- "Track this" pressed twice (two tabs, a double click that beats the button
-- disabling) must not make two cards. Manual entries have no source_job_id and
-- are unconstrained.
create unique index if not exists user_applications_one_per_listing
  on public.user_applications (user_id, source_job_id)
  where source_job_id is not null;

-- Row-level security: the anon key is public, so this is the only thing
-- standing between one account's applications and another's.
alter table public.user_applications enable row level security;

drop policy if exists "read own applications" on public.user_applications;
create policy "read own applications" on public.user_applications
  for select using (auth.uid() = user_id);

drop policy if exists "insert own applications" on public.user_applications;
create policy "insert own applications" on public.user_applications
  for insert with check (auth.uid() = user_id);

drop policy if exists "update own applications" on public.user_applications;
create policy "update own applications" on public.user_applications
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "delete own applications" on public.user_applications;
create policy "delete own applications" on public.user_applications
  for delete using (auth.uid() = user_id);

-- updated_at is maintained here rather than by the client, so it can't be
-- back-dated by whoever holds the anon key. It also orders each board column.
create or replace function public.touch_user_applications()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists user_applications_touch on public.user_applications;
create trigger user_applications_touch
  before update on public.user_applications
  for each row execute function public.touch_user_applications();
