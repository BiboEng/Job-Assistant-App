# Plans & billing — setup and go-live checklist

Everything you have to do yourself to take payments for Jobassist Pro and
Ultimate through Stripe, in the order you'd do it. The code is done; this is
the part that lives in Stripe, Supabase, your server's environment, and the
law.

> **Not legal or tax advice.** This lists what the integration needs and the
> questions to take to a professional. Have a lawyer licensed in your province
> review the Terms, Privacy Policy and Refund Policy, and an accountant confirm
> your sales-tax position, **before the first real payment**.

- [What's built](#whats-built)
- [1. Your business, as a sole proprietor in Canada](#1-your-business-as-a-sole-proprietor-in-canada)
- [2. Sales tax](#2-sales-tax)
- [3. Stripe setup (test mode first)](#3-stripe-setup-test-mode-first)
- [4. Supabase](#4-supabase)
- [5. Server environment](#5-server-environment)
- [6. Testing locally](#6-testing-locally)
- [7. Go-live checklist](#7-go-live-checklist)
- [8. Running it](#8-running-it)
- [Known limitations](#known-limitations)

## What's built

- **Three plans**: Regular (free), Pro, Ultimate, defined once in
  `server/src/plans.js`. Limits are enforced **on the server**, except resume
  export formats (made in the browser, so a UI lock) and Tracker cards (a
  Supabase trigger).
- **The "More features" section** on the landing page (`/pricing`) and a
  **Plans page** in the app (`/plans`), both showing prices read live from
  Stripe, so the price shown is the price charged.
- **Stripe Checkout** (hosted by Stripe, so card data never touches your
  servers) with a confirmation step first. That step states the price,
  automatic renewal, how to cancel and the 14-day refund. Checkout then
  requires ticking agreement to your Terms.
- **Stripe Customer Portal** for cancelling, switching plan and updating the
  card ("Manage billing").
- **Signature-verified webhooks.** Access is granted only from Stripe's own
  record of the subscription, re-read from Stripe on every event.
- **Legal pages** `/terms`, `/privacy` and `/refunds`, as drafts. They show a
  "Draft" notice, and checkout stays disabled, until you fill in your details.

## 1. Your business, as a sole proprietor in Canada

You don't need a corporation to sell. As a sole proprietor, you are the
seller, under your own legal name.

- [ ] **Register the business name if you trade as "Jobassist".** Most
      provinces require a business name that differs from your own legal name
      to be registered (Ontario, for example, under the Business Names Act
      through the Ontario Business Registry). It's a small fee and usually
      online. Check your province's registry.
- [ ] **Fill in `client/src/legal/business.js`.** Add your legal name, your
      province, a mailing address (a mailbox service is fine) and ideally a
      phone number. Consumer-protection rules for online sales require the
      seller to be identified. Ontario's rules for internet agreements, for
      example, ask for name, address and telephone number. Until this is done,
      the legal pages say "Draft" and the Plans page won't open checkout.
- [ ] **Have a lawyer review the three drafts**
      (`client/src/legal/documents.js`). Ask specifically about:
  - **Quebec.** If you'll sell to Quebec consumers: the Consumer Protection
    Act's rules for distance contracts (information to give before the sale, a
    copy of the contract afterwards, notice of price changes), and the Charter
    of the French Language's requirements for contracts and commercial
    documents, which may mean French versions.
  - **Ontario.** The Consumer Protection Act's internet-agreement disclosure,
    and giving the customer a copy of the agreement after purchase. Stripe's
    receipt plus the linked Terms may or may not be enough.
  - **Auto-renewal disclosure and cancellation.** The flow already states the
    renewal terms before payment and offers online cancellation. Confirm this
    satisfies the provinces you sell to, and US state laws such as
    California's if you'll have US customers.
  - **Privacy.** PIPEDA, and Quebec's Law 25 if you have Quebec users. You're
    named as the person responsible for personal information. Confirm the
    list of service providers and the cross-border wording.
  - **The career-survey rating email** (`n8n/`). Under Canada's anti-spam law
    (CASL), confirm it's allowed. At minimum, make sure it identifies you and
    includes a working unsubscribe link.
- [ ] **Keep the legal pages true.** If the app starts sending data somewhere
      new, update the Privacy Policy. `effectiveDate` in `business.js` is the
      date shown on all three pages.
- [ ] **Stripe requires you to be of legal age** to hold the account.
- [ ] **Income tax.** Report the income as self-employment (form T2125 with
      your T1). Keep records for six years. A separate bank account for the
      business makes this much easier.

## 2. Sales tax

- **Canada (GST/HST).** You're a "small supplier" and don't have to register
  until your worldwide taxable sales pass **$30,000 over four consecutive
  calendar quarters**. You can register voluntarily before that. Once
  registered, you charge GST/HST based on the customer's province.
- **Quebec (QST)** and some other provinces (for example BC, Saskatchewan and
  Manitoba) have their own rules for sellers of digital services, including
  sellers outside the province. Ask your accountant which apply.
- **Other countries.** The EU and the UK charge VAT on digital services sold
  to their consumers, **with no minimum threshold for sellers outside them**.
  US states have their own thresholds, and some tax SaaS. Selling
  internationally from day one means real obligations. Decide with an
  accountant whether to limit where you sell at first.
- **Stripe Tax calculates and collects tax, but you still register and
  file.** To turn it on:
  1. Stripe → **Tax → Settings**: set your head-office address.
  2. **Tax → Locations → Add registration** for each place you're actually
     registered, with your registration number. Adding it in Stripe doesn't
     register you with the tax authority; you do that first.
  3. Set each Product's **tax code**. Pick it from Stripe's list (see Stripe's
     [tax codes guide](https://docs.stripe.com/tax/tax-codes), including the
     pages on digital products and AI services), and have your accountant
     confirm the choice. Don't guess one.
  4. Decide whether prices **include** tax ("inclusive") or have it
     **added** ("exclusive"). This is set on each Price. The site's price
     note follows it.
  5. Set `STRIPE_AUTOMATIC_TAX=true`.

  **Without an active registration, Stripe Tax collects nothing and shows no
  error.** Don't set the variable until step 2 is done. Checkout then
  collects the full billing address it needs.
- **Alternative: a merchant of record** (Paddle, Lemon Squeezy). They become
  the legal seller and handle sales tax and VAT everywhere, for a higher fee.
  That would replace the Stripe integration rather than sit next to it; worth
  weighing if you expect many international customers early.

## 3. Stripe setup (test mode first)

Do all of this in a **sandbox** first (Stripe → Sandboxes; keeps test data
apart from live). Then repeat it in live mode. **Live mode has different ids
for everything**: products, prices, webhook secret, portal configuration.

- [ ] **Account.** Choose Canada, business type Individual / sole
      proprietorship. You'll need your SIN, address, date of birth and a
      Canadian bank account for payouts.
- [ ] **Settings → Business → Public details.** Business name, support email,
      your website URL, and **Terms of service URL** =
      `https://YOUR-SITE/terms`. Checkout **won't start** without the Terms URL:
      the integration requires ticking agreement to it. Add the Privacy policy
      URL `https://YOUR-SITE/privacy` too.
- [ ] **Statement descriptor.** Something recognisable on a card statement,
      e.g. `JOBASSIST`. It reduces "I don't recognise this charge" disputes.
- [ ] **Products** (Product catalog): create **two Products**, "Jobassist
      Pro" and "Jobassist Ultimate".
  - On each: a **monthly** recurring Price (e.g. $9 / $19) and optionally a
    **yearly** one (e.g. $90 / $190, about two months free). Pick your
    currency: CAD, or USD if most customers will be American. The site shows
    whatever currency you set.
  - On each Price, add metadata `jobassist_plan` = `pro` or `ultimate`. This
    is optional but recommended: it keeps existing subscribers on the right
    plan if you ever change prices.
  - Copy the four `price_…` ids into the env (section 5).
- [ ] **Settings → Billing → Customer portal.** Turn on:
  - customers can **cancel** subscriptions, set to *at the end of the billing
    period*;
  - **update payment methods**, and **view invoice history**;
  - **switch plans**: add both Products with their prices, so people can move
    between Pro, Ultimate, monthly and yearly, with **proration** on (the
    Refund Policy says switching is prorated);
  - links to your Terms and Privacy Policy.
- [ ] **Settings → Billing → Subscriptions and emails / Customer emails.**
  Turn on:
  - receipts for successful payments;
  - emails about failed payments and expiring cards;
  - **renewal reminders for yearly subscriptions.** The Refund Policy
    promises a reminder before a yearly plan renews, and some auto-renewal
    laws require one.

  Leave **Smart Retries** on for failed payments. When retries run out,
  choose to *cancel* the subscription (the app then moves the user back to
  Regular).
- [ ] **Developers → Webhooks → Add endpoint.**
  - URL: `https://YOUR-API/api/billing/webhook`.
  - Events: `checkout.session.completed`,
    `checkout.session.async_payment_succeeded`,
    `checkout.session.async_payment_failed`, `checkout.session.expired`,
    `customer.subscription.created`, `customer.subscription.updated`,
    `customer.subscription.deleted`, `customer.subscription.paused`,
    `customer.subscription.resumed`, `customer.subscription.trial_will_end`,
    `invoice.paid`, `invoice.payment_failed`,
    `invoice.payment_action_required`, `customer.deleted`.
  - Copy the **signing secret** (`whsec_…`) into `STRIPE_WEBHOOK_SECRET`.
- [ ] **API key: create a restricted key** (Developers → API keys → Create
      restricted key) rather than using the full secret key. Grant **Write**
      on Customers, Checkout Sessions and Customer portal, and **Read** on
      Subscriptions and Prices. Leave everything else at None. If a call
      fails with a permissions error, add just that resource. Put it in
      `STRIPE_SECRET_KEY`.
- [ ] **Security.** Turn on two-factor authentication for your Stripe login.
      Never commit keys: `.env` files are gitignored, so keep it that way.

## 4. Supabase

- [ ] **Apply `supabase/migrations/20260930120000_user_subscriptions.sql`.**
      Go to Supabase → SQL Editor, paste and Run, after the earlier
      migrations. It creates the plan table (server-only) and the 15-card
      Tracker limit for Regular.
- [ ] **Copy the service-role (secret) key.** It's under Project Settings →
      API keys. Put it in `server/.env` as `SUPABASE_SERVICE_ROLE_KEY`,
      **never** in `client/.env`.
- [ ] **Check `SUPABASE_URL` is set in `server/.env`.** Billing refuses to
      run without verified sign-ins: otherwise anyone could claim to be a
      paying user.

## 5. Server environment

In `server/.env`. See `server/.env.example` for comments on each.

```
STRIPE_SECRET_KEY=rk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_PRO_MONTHLY=price_...
STRIPE_PRICE_PRO_YEARLY=price_...          # optional
STRIPE_PRICE_ULTIMATE_MONTHLY=price_...
STRIPE_PRICE_ULTIMATE_YEARLY=price_...     # optional
STRIPE_AUTOMATIC_TAX=false                 # true only after section 2
APP_URL=http://localhost:5173              # your deployed site in production
SUPABASE_URL=https://....supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
ULTIMATE_EVALUATOR_MODEL=                  # e.g. openai/gpt-4o
```

- On restart the server logs `Billing: on (plans enforced)`, or lists
  exactly which variables are missing.
- **`ULTIMATE_EVALUATOR_MODEL`** is what makes Ultimate's "stronger feedback
  model" true. Until it's set, the pricing page doesn't list that feature.
  Pick a model you've tried for feedback quality and cost.

## 6. Testing locally

1. **Without Stripe at all.** Set `DEV_PLAN=regular` (or `pro`/`ultimate`) and
   restart the server. That plan's limits apply to everyone, so you can see
   the locks, the "N left today" counts and the upgrade prompts. It's ignored
   once billing is on.
2. **With Stripe test mode.** Install the Stripe CLI, `stripe login`, then:

   ```bash
   stripe listen --forward-to localhost:3001/api/billing/webhook
   ```

   It prints a `whsec_…` for local use; put that in `STRIPE_WEBHOOK_SECRET`
   while testing.
3. **Walk through the flows**, using test cards and any future date and CVC:
   - Subscribe with `4242 4242 4242 4242`. You land back on Plans, it says
     "Confirming…", then "You're on Pro".
   - Card requiring authentication (3-D Secure): `4000 0027 6000 3184`.
   - Declined card: `4000 0000 0000 0002`.
   - Manage billing → cancel. The plan shows "Cancelled, you keep Pro
     until…". Then, in the Stripe Dashboard, cancel the subscription
     immediately: you're back to Regular.
   - Switch Pro → Ultimate in the portal. The plan changes, prorated.
   - A failed renewal: after subscribing with 4242, change the card in
     Manage billing to `4000 0000 0000 0341` (it saves, but every charge on
     it fails). Then charge the subscription again from the Stripe
     Dashboard. The subscription goes `past_due` and the Plans page shows the
     "last payment didn't go through" warning.
   - Regular limits: 4 interviews in a day (the 4th is refused), 2 job
     searches, a 16th Tracker card, a locked export format.
4. **Run the tests.** `cd server && npm test` and `cd client && npm test`.

## 7. Go-live checklist

- [ ] Sections 1 to 4 done in **live** mode (new products, prices, webhook,
      portal settings, tax registrations; the ids differ from test mode).
- [ ] `client/src/legal/business.js` filled in, and the legal pages reviewed
      by a lawyer.
- [ ] **HTTPS everywhere.** Set `APP_URL` to the live site, `CLIENT_ORIGIN`
      to the same, `FORCE_HTTPS=true`, and `TRUST_PROXY` to match your host.
- [ ] **`DATA_DIR` on a persistent volume.** It holds interview history and
      today's usage counts. On an ephemeral filesystem, a redeploy wipes both.
- [ ] **Switch off the free model.** `server/.env` currently uses a `:free`
      OpenRouter model. Free models are heavily rate-limited and their terms
      may not allow use in a paid product. Use a paid model, and check the
      model provider's commercial-use terms.
- [ ] **Check Adzuna's API terms** allow use in a paid product, and show any
      attribution they require on Job Matches.
- [ ] **Raise `MODEL_CALLS_PER_DAY`.** It's a global ceiling across all users
      (default 5,000); at capacity everyone, paying or not, is refused. Size
      it to your traffic and budget.
- [ ] **Check your costs against the plans.**
  - Ultimate's daily limits allow up to about 1,500 model calls a day. A user
    at every limit every day, especially with a pricier evaluator model,
    could cost more than the subscription.
  - Look at real usage in the OpenRouter dashboard after launch, and adjust
    limits in `server/src/plans.js` (and the client mirror) if needed.
  - Limit changes for existing subscribers need 30 days' notice (Terms,
    section 3).
- [ ] **Make one real purchase yourself, then refund it.** It confirms the
      live webhook, the receipt email and the tax lines end to end.

## 8. Running it

- **Refunds.** In Stripe → Payments, open the payment → **Refund**. For a
  14-day refund, also cancel the subscription immediately (Subscriptions →
  Cancel → Immediately). The webhook moves the user back to Regular.
  Stripe Tax reverses the tax on refunded invoices.
- **Disputes / chargebacks.** Stripe emails you, and you respond in the
  Dashboard with evidence. The receipt, the Terms acceptance recorded on the
  Checkout Session, and usage all help.
- **Account deletion requests** (privacy law gives users this right):
  1. **Cancel their Stripe subscription first.** Deleting the Supabase user
     removes their plan row, but Stripe would keep billing them.
  2. Delete the user in Supabase → Authentication. This cascades to their
     survey, tracker and plan rows.
  3. Remove their interviews from `DATA_DIR/interviews.json`. Records carry
     `ownerId: "u-<their user id without dashes>"`.
- **Price changes.** Create a new Price and put its id **first** in the
  `STRIPE_PRICE_*` variable, keeping the old id after a comma so existing
  subscribers keep access. Email existing subscribers at least 30 days before
  moving them (Terms, section 3).
- **A user says they paid but are still on Regular.** Their Plans page
  re-checks Stripe on return from Checkout. Otherwise, look at the webhook's
  delivery log in Stripe → Developers → Webhooks, and resend the event.
  Processing is idempotent, so resending is always safe.

## Known limitations

- **Resume export formats are locked only in the UI.** Exports are generated
  in the browser, so a determined user could bypass it. Everything that
  costs you money (model calls) is enforced on the server.
- **Usage counters and the plan cache are per server process.** This is fine
  for the single-instance deployment the app is built for (see CLAUDE.md →
  Storage). Running several instances would need a shared store.
- **One subscription per user** is enforced by refusing checkout while one is
  live. If two ever exist anyway, the user gets the higher plan, and you
  should refund the extra.
- **No self-serve account deletion.** Requests come by email (section 8).
