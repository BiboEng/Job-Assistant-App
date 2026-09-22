-- Onboarding career survey: one optional row per signed-in user.
--
-- APPLY THIS BY HAND before the survey works: Supabase → SQL Editor → paste →
-- Run (or `supabase db push` if you use the CLI). Until it exists the client
-- treats the feature as switched off — no banner, no menu item, no errors.
--
-- THIS DATA IS NOT READ BY ANY AI FEATURE. Nothing in server/ knows this table
-- exists; interview questions, feedback, the resume builder and job matching
-- are all unchanged by it. It is collected now so it can be wired into those
-- prompts later, deliberately and separately. See CLAUDE.md → "Career survey".
--
-- One row per user (user_id is the primary key), because the survey is a
-- profile, not an event log: retaking it edits the same answers.

create table if not exists public.user_survey_responses (
  user_id uuid primary key references auth.users (id) on delete cascade,

  -- 'dismissed' covers both "skipped the banner" and "exited partway"; the
  -- answers given before exiting are still saved, so returning resumes them.
  -- No row at all is the third state, and the only one that prompts.
  status text not null default 'dismissed'
    check (status in ('dismissed', 'completed')),

  -- Q1 What's your current career stage?
  career_stage text
    check (career_stage in ('student', 'entry_level', 'mid_level', 'senior', 'career_changer')),

  -- Q2 What industry or field are you primarily targeting?
  target_industry text
    check (target_industry in ('technology', 'finance', 'healthcare', 'education', 'marketing', 'design', 'sales', 'engineering', 'government', 'retail', 'nonprofit', 'other')),
  target_industry_other text
    check (char_length(target_industry_other) <= 120),

  -- Q3 What's your current employment status?
  employment_status text
    check (employment_status in ('employed', 'job_hunting', 'student', 'freelance')),

  -- Q4 How soon are you hoping to land a new role?
  timeline text
    check (timeline in ('asap', '1_3_months', '3_6_months', 'exploring')),

  -- Q5 What's your biggest challenge in job searching right now? (multi)
  job_search_challenges text[] not null default '{}'::text[]
    check (job_search_challenges <@ array['resume', 'interview_skills', 'job_leads', 'networking', 'confidence', 'other']::text[]),

  -- Q6 Which type of interviews make you most nervous? (multi)
  interview_nerves text[] not null default '{}'::text[]
    check (interview_nerves <@ array['behavioral', 'technical', 'case_study', 'panel', 'salary_negotiation']::text[]),

  -- Q7 What's your target job title or role?
  target_role text
    check (char_length(target_role) <= 120),

  -- Q8 How many years of professional experience do you have?
  years_experience text
    check (years_experience in ('0_1', '2_4', '5_9', '10_plus')),

  -- Q9 What's your highest level of education?
  education_level text
    check (education_level in ('high_school', 'bachelors', 'masters', 'phd', 'other')),

  -- Q10 Do you already have a resume, or are you starting from scratch?
  resume_status text
    check (resume_status in ('have_one', 'from_scratch', 'not_sure')),

  -- Q11 Are you targeting specific companies, or open to any?
  company_targeting text
    check (company_targeting in ('specific', 'open_in_field', 'open_to_anything')),
  target_companies text
    check (char_length(target_companies) <= 600),

  -- Q12 What's most important to you in using this app? (multi)
  app_goals text[] not null default '{}'::text[]
    check (app_goals <@ array['interview_practice', 'resume_building', 'job_discovery', 'confidence']::text[]),

  -- Q13 What's your work arrangement preference?
  work_arrangement text
    check (work_arrangement in ('remote', 'hybrid', 'in_office', 'no_preference')),

  -- Q14 Target salary range. The opt-out is its own column so "preferred not
  -- to say" stays distinguishable from "skipped the question".
  salary_expectation text
    check (char_length(salary_expectation) <= 120),
  salary_opt_out boolean not null default false,

  -- Q15 What's one thing you wish an interview coach could help you with?
  coach_wish text
    check (char_length(coach_wish) <= 600),

  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.user_survey_responses is
  'Optional onboarding career survey. Collected for future personalization; not read by any AI prompt today.';

-- Row-level security: the anon key is public, so this is the only thing
-- standing between one account's answers and another's.
alter table public.user_survey_responses enable row level security;

drop policy if exists "read own survey" on public.user_survey_responses;
create policy "read own survey" on public.user_survey_responses
  for select using (auth.uid() = user_id);

drop policy if exists "insert own survey" on public.user_survey_responses;
create policy "insert own survey" on public.user_survey_responses
  for insert with check (auth.uid() = user_id);

drop policy if exists "update own survey" on public.user_survey_responses;
create policy "update own survey" on public.user_survey_responses
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "delete own survey" on public.user_survey_responses;
create policy "delete own survey" on public.user_survey_responses
  for delete using (auth.uid() = user_id);

-- updated_at is maintained here rather than by the client, so it can't be
-- back-dated by whoever holds the anon key.
create or replace function public.touch_user_survey_responses()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists user_survey_responses_touch on public.user_survey_responses;
create trigger user_survey_responses_touch
  before update on public.user_survey_responses
  for each row execute function public.touch_user_survey_responses();
