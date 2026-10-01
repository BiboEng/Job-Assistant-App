# Supabase schema

The app's auth is Supabase; so are the few tables it stores data in. Everything
else (interviews, resumes, job matches) lives in the Express server — see
`CLAUDE.md` → "Storage".

**Apply the migrations in filename order.** The ratings migration reads
`user_survey_responses`, so the survey one has to exist first.

## Applying a migration

There is no Supabase CLI setup in this repo, and nothing applies these files
automatically. Run them once per project (dev, prod, …):

1. Supabase → your project → **SQL Editor** → New query.
2. Paste the contents of the migration file and **Run**.

Or, if you do use the CLI and have the project linked:

```bash
supabase db push
```

The files are idempotent (`create table if not exists`, `drop policy if
exists`), so re-running one is safe.

## Migrations

| file | what it adds |
| --- | --- |
| `20260921120000_user_survey_responses.sql` | `public.user_survey_responses` — the optional onboarding career survey, one row per user, with row-level security scoped to `auth.uid()`. |
| `20260922090000_website_ratings.sql` | `public.website_ratings` + `public.rating_requests`, and the two `security definer` functions the n8n rating email calls. Service-role only: RLS is on with **no** policies, so the anon key in the client bundle can't reach either table — and in particular can't read live invite tokens. See `n8n/README.md`. |
| `20260927100000_user_applications.sql` | `public.user_applications` — the Application Tracker's cards, many rows per user (uuid `id`), with the same four `auth.uid() = user_id` policies as the survey and a partial unique index so one Job Matches listing can only be tracked once. |
| `20260930120000_user_subscriptions.sql` | Plans & billing. `public.user_subscriptions` — each account's plan and Stripe ids, written only by the API server (service-role key) from Stripe's record; RLS on with **no** policies, so the browser can't read or forge a plan. Also a trigger capping Regular accounts at 15 `user_applications` cards. Apply it when you switch billing on (see `BILLING.md`); it needs the applications migration first. |

Until a migration is applied, the feature that needs it stays switched off in
the UI rather than erroring: the client reads a missing table as "not
available" and simply doesn't show the survey banner or menu item, and the Applications
screen says the table is missing while Job Matches hides "Track this". The ratings
tables have no UI at all — they're driven entirely by n8n — so nothing in the
app changes either way.
