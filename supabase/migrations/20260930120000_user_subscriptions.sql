-- Plans & billing: which plan each account is on, as recorded from Stripe.
--
-- APPLY THIS BY HAND when you switch billing on: Supabase → SQL Editor →
-- paste → Run (or `supabase db push`). Apply it AFTER
-- 20260927100000_user_applications.sql — it adds a trigger to that table.
--
-- Two things live here:
--
--   1. public.user_subscriptions — one row per user who has ever started a
--      checkout: their Stripe customer id and the plan Stripe says they're
--      entitled to right now. SERVER-ONLY: RLS is on with NO policies, so the
--      anon key in the browser bundle can neither read nor write it. The API
--      server writes it with the service-role key, and only from Stripe's own
--      record of the subscription (a signature-verified webhook, or a re-read
--      of the customer from Stripe's API). No row = Regular.
--
--   2. A trigger capping Application Tracker cards at 15 on Regular. The
--      tracker writes straight from the browser to Supabase, so this is the
--      only place that limit CAN be enforced. Keep the 15 in step with
--      `trackerCards` in server/src/plans.js — client/test/plans.test.js
--      checks. Existing cards are never touched: an account over the limit
--      (after a downgrade) keeps and can edit every card, and just can't add
--      more until it's back under.
--
-- See CLAUDE.md → "Plans & billing" and BILLING.md.

create table if not exists public.user_subscriptions (
  user_id uuid primary key references auth.users (id) on delete cascade,

  -- The plan this account is entitled to NOW, computed by the server from the
  -- customer's Stripe subscriptions: active / trialing / past_due count.
  plan text not null default 'regular'
    check (plan in ('regular', 'pro', 'ultimate')),

  -- Stripe's subscription status (active, past_due, canceled, …), for the
  -- Plans page. Null = never subscribed.
  status text
    check (status is null or char_length(status) <= 40),

  billing_interval text
    check (billing_interval is null or billing_interval in ('month', 'year')),

  -- One Stripe customer per account, created by the server on first checkout.
  stripe_customer_id text unique
    check (stripe_customer_id is null or stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'),

  stripe_subscription_id text
    check (stripe_subscription_id is null or stripe_subscription_id ~ '^sub_[A-Za-z0-9]+$'),

  stripe_price_id text
    check (stripe_price_id is null or char_length(stripe_price_id) <= 255),

  current_period_end timestamptz,
  -- When a scheduled cancellation takes effect (null = renews).
  cancel_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.user_subscriptions is
  'Plan per account, written only by the API server (service role) from Stripe. No RLS policies: not readable or writable with the anon key.';

-- RLS on, and deliberately NO policies: service role only.
alter table public.user_subscriptions enable row level security;

create or replace function public.touch_user_subscriptions()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists user_subscriptions_touch on public.user_subscriptions;
create trigger user_subscriptions_touch
  before update on public.user_subscriptions
  for each row execute function public.touch_user_subscriptions();

-- --- Application Tracker: 15 cards on Regular ------------------------------

create or replace function public.enforce_application_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  user_plan text;
  card_count integer;
begin
  -- Serialise inserts per user, so two tabs adding the 15th card at the same
  -- moment can't both squeeze in.
  perform pg_advisory_xact_lock(hashtext('user_applications:' || new.user_id::text));

  select plan into user_plan from public.user_subscriptions where user_id = new.user_id;
  if coalesce(user_plan, 'regular') <> 'regular' then
    return new;
  end if;

  select count(*) into card_count from public.user_applications where user_id = new.user_id;
  if card_count >= 15 then
    raise exception 'application_limit_reached'
      using errcode = 'P0001',
            hint = 'Regular accounts can track up to 15 applications.';
  end if;
  return new;
end;
$$;

-- Callable by the trigger only; nobody needs to call it directly.
revoke all on function public.enforce_application_limit() from public;

drop trigger if exists user_applications_plan_limit on public.user_applications;
create trigger user_applications_plan_limit
  before insert on public.user_applications
  for each row execute function public.enforce_application_limit();
