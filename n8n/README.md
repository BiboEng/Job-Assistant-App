# n8n — post-survey rating email

Two workflows. One emails people a day after they finish the career survey and
asks them to rate the site; the other catches the click and writes the rating
to Supabase.

```
                                     ┌─ 1 ─┐
  survey completed ──(24h)──▶ daily schedule ──▶ claim_rating_candidates()
                                                          │
                                                   one email each,
                                                 five one-click links
                                                          │
                                                          ▼
  user clicks a star ──▶ webhook /rate ──▶ record_website_rating() ──▶ website_ratings
                                └─ 2 ─┘            │
                                          thank-you page with an
                                          optional comment box
                                                   │
                            webhook /rate-comment ─┘
```

| file | what it is |
| --- | --- |
| `post-survey-rating-request.json` | workflow 1 — the daily send |
| `capture-rating.json` | workflow 2 — the two webhooks that record the answer |

**None of this is read by any AI feature**, exactly like the survey it follows
from. It is collected and stored, nothing more. See `CLAUDE.md` → "Career
survey" and "Website ratings".

## Before you start

Apply `supabase/migrations/20260922090000_website_ratings.sql` (Supabase → SQL
Editor → paste → Run). It creates `website_ratings`, `rating_requests` and the
two functions the workflows call. The survey migration must already be applied.

## 1. The Supabase credential

Both workflows reach Supabase with the **service role** key, not the anon key.
The functions are `security definer` and read `auth.users`, so they are granted
to `service_role` only — the anon key cannot call them, by design.

> **The service role key bypasses row-level security entirely.** It belongs in
> n8n's credential store and nowhere else. Never put it in `client/.env`:
> `vite.config.js` sets `envPrefix: ["VITE_", "SUPABASE_"]`, so anything named
> `SUPABASE_*` is bundled into the browser.

Get it from Supabase → **Project Settings → API Keys → Secret keys**. On this
project that is a key beginning `sb_secret_`, *not* a long `eyJ…` JWT — see
"New-style API keys" below, which is why the n8n **Supabase API** credential
does not work here.

In n8n, **Credentials → New → Header Auth**:

- **Name:** `Supabase secret key`
- **Header name:** `apikey`
- **Header value:** the `sb_secret_…` key

Both HTTP Request nodes use it. One header is genuinely all Supabase needs —
verified against this project: `apikey` alone returns 200, and that is the
header the gateway actually authenticates on.

### New-style API keys, and the "forbidden" credential test

Supabase replaced the legacy JWT keys (`anon` / `service_role`, both `eyJ…`)
with publishable (`sb_publishable_…`) and secret (`sb_secret_…`) keys. Two
consequences, both of which look like a broken credential:

- **`Authorization: Bearer <sb_secret_…>` returns 401.** The new keys aren't
  JWTs, so bearer auth can't parse them. Anything that authenticates that way —
  including n8n's built-in **Supabase API** credential — fails on this project.
  Use Header Auth with `apikey`, as above.
- **n8n's credential *test* hits `GET /rest/v1/`**, which answers
  `{"message":"Secret API key required"}` for anything that isn't a secret key.
  If you paste the *publishable* key there you get exactly the "forbidden" that
  sends people looking for a permissions problem that doesn't exist. The fix is
  the right key, not a policy change.

If a test still fails but the key is right, save it anyway and run the workflow:
the nodes here only ever call `/rest/v1/rpc/…`, never the root endpoint the test
uses.

## 2. Import and wire up

1. **Import `capture-rating.json` first.** n8n → Workflows → Import from File.
2. Open the **GET /rate** node and copy its **Production URL**. It looks like
   `https://your-n8n-host/webhook/rate`.
3. Assign the `Supabase service role` credential to the **Record rating** node.
4. **Activate** the workflow. A webhook only answers on its production URL once
   the workflow is active — this is the single most common reason the links in
   the email 404.
5. Import `post-survey-rating-request.json`.
6. Open its **Config** node and set:

   | field | value |
   | --- | --- |
   | `supabaseUrl` | your project URL (already filled in) |
   | `webhookBase` | the URL from step 2 **with the trailing `/rate` removed** |
   | `fromEmail` | the address the email is sent from |
   | `productName` | what the email calls the product |
   | `minAgeHours` | `24` — the "1 day later" in the brief |
   | `maxAgeDays` | `30` — see "Why there's an upper bound" below |

7. Assign the credential to **Claim candidates**, and an **SMTP** credential to
   **Send rating email**.
8. Activate it.

## 3. The email node

It's the generic **Send Email** (SMTP) node, so it works with a Gmail app
password, Mailgun, Postmark, SendGrid SMTP, Amazon SES — anything that speaks
SMTP. If you'd rather use a provider's API, delete that one node and drop in
their node; it reads `{{ $json.email }}`, `{{ $json.subject }}`,
`{{ $json.html }}` and `{{ $json.text }}`, so a replacement needs those four
fields and nothing else.

Sending from a domain without SPF/DKIM set up is the usual reason these land in
spam. That's a DNS job, not an n8n one.

## Testing it without waiting a day

Set `minAgeHours` to `0` in Config and **Execute Workflow**. Everyone who has
completed the survey and hasn't been invited yet gets an email immediately.
Set it back to `24` afterwards.

To re-test with the same account, delete its claim first:

```sql
delete from public.rating_requests where user_id = '<uuid>';
delete from public.website_ratings  where user_id = '<uuid>';
```

## Reading the results

```sql
select u.email, w.rating, w.comment, w.created_at
from public.website_ratings w
join auth.users u on u.id = w.user_id
order by w.created_at desc;

-- average and distribution
select round(avg(rating), 2) as avg_rating, count(*) as responses
from public.website_ratings;

select rating, count(*) from public.website_ratings group by rating order by rating;

-- response rate
select
  (select count(*) from public.rating_requests) as invited,
  (select count(*) from public.website_ratings) as rated;
```

## Design notes, and why

**Nobody is emailed twice.** `claim_rating_candidates()` inserts the invite row
*in the same statement that returns it*, so a user it hands back already has
their claim recorded. If the workflow dies between claiming and sending, that
person misses their email — which is the right way round. The alternative
(select, then insert later) means a crash or two overlapping runs emails someone
twice, and a duplicate "please rate us" is far more annoying than a missing one.
A `unique` index on `rating_requests.user_id` backs it up.

**The link carries a token, not a user id.** A one-click rating URL is a
credential. `?user_id=<uuid>&rating=5` would let anyone rate as anyone, and user
ids are not secret. The token is a random uuid, single-purpose, and expires
after 30 days. Anyone who *forwards* the email can still rate on the original
recipient's behalf — inherent to one-click email, and acceptable for a
satisfaction score.

**Bad links get a sentence, not a 500.** `record_website_rating()` returns
`(ok, message)` instead of raising, and the HTTP node sets `neverError`, so an
expired token produces a readable page. Someone clicking a link from an old
email shouldn't meet a stack trace.

**Clicking a second star corrects the first.** The write is an upsert keyed on
`user_id` — `website_ratings` holds the latest rating, not a history. People
misclick in emails, and their correction should be the answer you keep. A later
comment doesn't wipe the rating, and a later star doesn't wipe the comment.

**The trigger is hourly, not daily.** It looks wasteful for a "one day later"
email and isn't. With a once-a-day run, a 24-hour minimum really means 24–48
hours, because anyone finishing the survey after the run time waits for the
*next* morning — so being twenty minutes late to the cutoff costs a whole day.
Hourly makes the delay `minAgeHours` ± 1h and removes the cutoff arithmetic
entirely. The cost is one query an hour that finds nothing almost every time,
and `claim_rating_candidates()` already guarantees nobody is claimed twice
however often it runs.

**Why there's an upper bound.** `maxAgeDays` stops the first run from emailing
every person who has *ever* completed the survey — which, on the day you switch
this on, would be all of them at once. After that it just means someone who
completed the survey four months ago and somehow never got an invite doesn't
suddenly get one.

**Both webhooks share one code path.** GET `/rate` and POST `/rate-comment` both
feed "Read request", which normalises query string and body into one shape.
Nothing from either is trusted: the token is looked up server-side, the rating
is re-checked in SQL, and everything rendered into the thank-you page is HTML
escaped.
