-- Post-survey website rating: the email invite and the rating it collects.
--
-- APPLY THIS BY HAND, after 20260921120000_user_survey_responses.sql:
-- Supabase → SQL Editor → paste → Run (or `supabase db push`).
--
-- Driven entirely by n8n (see `n8n/README.md`), which calls the two functions
-- at the bottom with the **service_role** key. Nothing in the app's client
-- touches any of this, and — like the survey itself — NO AI FEATURE READS IT.
--
-- The shape is: one invite per user, carrying an unguessable token, and one
-- rating per user. The token is the whole security story for a one-click email
-- link: without it the callback would have to be `?user_id=<uuid>&rating=5`,
-- which anyone could forge for anyone.

-- One rating per user — the latest one they gave, not a history. Re-clicking a
-- different star in the same email corrects it rather than adding a row.
create table if not exists public.website_ratings (
  user_id uuid primary key references auth.users (id) on delete cascade,

  rating smallint not null check (rating between 1 and 5),

  -- Optional free text from the thank-you page after they click a star.
  comment text check (char_length(comment) <= 1000),

  -- Where the rating came from, so a later in-app prompt doesn't get confused
  -- with this email campaign.
  source text not null default 'post_survey_email',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.website_ratings is
  'Website satisfaction ratings. Collected by the n8n post-survey email. Not read by any AI feature.';

-- One invite per user: the unique index is what stops a retried or overlapping
-- n8n run emailing the same person twice.
create table if not exists public.rating_requests (
  token uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  sent_at timestamptz not null default now(),
  used_at timestamptz,
  -- After this the link stops working, so an old forwarded email can't be used
  -- to write a rating a year later.
  expires_at timestamptz not null default now() + interval '30 days'
);

comment on table public.rating_requests is
  'One emailed rating invite per user. The token is the credential in the email link.';

-- RLS on both, with NO policies: these tables are service_role-only. The anon
-- key is public and ships in the client bundle, so leaving either readable
-- would expose every user''s rating — and, worse, every live invite token.
alter table public.website_ratings enable row level security;
alter table public.rating_requests enable row level security;

create or replace function public.touch_website_ratings()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists website_ratings_touch on public.website_ratings;
create trigger website_ratings_touch
  before update on public.website_ratings
  for each row execute function public.touch_website_ratings();


-- ---------------------------------------------------------------------------
-- 1. Who should be emailed today?
--
-- Claiming and reading are ONE statement on purpose. If n8n listed candidates
-- and then inserted invites in a later node, a run that failed halfway — or two
-- runs overlapping — would email somebody twice. Here the INSERT is the claim:
-- a user returned by this function already has their invite row, so the next
-- call cannot return them again.
--
-- `p_min_age_hours` is the "1 day later" in the brief. `p_max_age_days` stops
-- the very first run mailing everyone who ever completed the survey.
create or replace function public.claim_rating_candidates(
  p_min_age_hours int default 24,
  p_max_age_days int default 30
)
returns table (user_id uuid, email text, token uuid)
language sql
security definer
set search_path = public, auth
as $$
  with eligible as (
    select r.user_id
    from public.user_survey_responses r
    where r.status = 'completed'
      and r.completed_at is not null
      and r.completed_at <= now() - make_interval(hours => p_min_age_hours)
      and r.completed_at >  now() - make_interval(days  => p_max_age_days)
      -- Never invited before, and hasn't already rated by some other route.
      and not exists (
        select 1 from public.rating_requests q where q.user_id = r.user_id
      )
      and not exists (
        select 1 from public.website_ratings w where w.user_id = r.user_id
      )
  ),
  created as (
    insert into public.rating_requests (user_id)
    select e.user_id from eligible e
    -- Belt and braces alongside the unique index: two concurrent runs racing on
    -- the same user leave one of them with nothing rather than an error.
    on conflict (user_id) do nothing
    returning rating_requests.user_id, rating_requests.token
  )
  select c.user_id, u.email::text, c.token
  from created c
  join auth.users u on u.id = c.user_id
  where u.email is not null;
$$;

comment on function public.claim_rating_candidates is
  'Atomically claims and returns users due a rating email. Calling it twice will not return the same user twice.';


-- ---------------------------------------------------------------------------
-- 2. Record a rating from a clicked link.
--
-- Returns a row rather than raising, so n8n can render a friendly page for an
-- expired link instead of turning a 500 into the user''s whole experience.
create or replace function public.record_website_rating(
  p_token uuid,
  p_rating smallint,
  p_comment text default null
)
returns table (ok boolean, message text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.rating_requests%rowtype;
begin
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    return query select false, 'That rating is not between 1 and 5.';
    return;
  end if;

  select * into v_request
  from public.rating_requests
  where token = p_token;

  if not found then
    return query select false, 'This rating link is not valid.';
    return;
  end if;

  if v_request.expires_at < now() then
    return query select false, 'This rating link has expired.';
    return;
  end if;

  -- Upsert, not insert: clicking 4 stars after having clicked 3 should correct
  -- the rating, which is what someone who misclicks in an email will try to do.
  insert into public.website_ratings (user_id, rating, comment)
  values (v_request.user_id, p_rating, nullif(btrim(coalesce(p_comment, '')), ''))
  on conflict (user_id) do update
    set rating  = excluded.rating,
        -- A later comment-only submission must not wipe the comment, and a
        -- later star click must not wipe a comment already left.
        comment = coalesce(excluded.comment, public.website_ratings.comment);

  update public.rating_requests
     set used_at = coalesce(used_at, now())
   where token = p_token;

  return query select true, 'Thanks — your rating has been saved.';
end;
$$;

comment on function public.record_website_rating is
  'Validates an emailed rating token and upserts the rating. Returns (ok, message) rather than raising.';


-- Both functions are SECURITY DEFINER and read auth.users, so they must not be
-- callable by the public anon key that ships in the client bundle.
revoke all on function public.claim_rating_candidates(int, int) from public, anon, authenticated;
revoke all on function public.record_website_rating(uuid, smallint, text) from public, anon, authenticated;
grant execute on function public.claim_rating_candidates(int, int) to service_role;
grant execute on function public.record_website_rating(uuid, smallint, text) to service_role;
