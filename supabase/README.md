# Supabase schema

The app's auth is Supabase; so is the one table it stores data in. Everything
else (interviews, resumes, job matches) lives in the Express server — see
`CLAUDE.md` → "Storage".

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

Until a migration is applied, the feature that needs it stays switched off in
the UI rather than erroring: the client reads a missing table as "not
available" and simply doesn't show the survey banner or menu item.
