import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Stripe from "stripe";

/*
 * Billing end to end, with Stripe and Supabase faked at their edges:
 *   - Stripe: a fake client for API calls, but the REAL SDK's webhook
 *     signing, so signature checks are the genuine article;
 *   - Supabase: an in-memory `user_subscriptions` behind the PostgREST fetch.
 * Env is set before anything imports config.js (dotenv never overrides a
 * variable that's already set, so a local server/.env can't leak in).
 */
const dir = await mkdtemp(join(tmpdir(), "mi-billing-"));
Object.assign(process.env, {
  DATA_DIR: dir,
  OPENROUTER_API_KEY: "", // model calls fail fast: lets us test quota refunds
  STRIPE_SECRET_KEY: "rk_test_fake",
  STRIPE_WEBHOOK_SECRET: "whsec_test_secret",
  STRIPE_PRICE_PRO_MONTHLY: "price_proM",
  STRIPE_PRICE_PRO_YEARLY: "price_proY",
  STRIPE_PRICE_ULTIMATE_MONTHLY: "price_ultM",
  STRIPE_PRICE_ULTIMATE_YEARLY: "",
  STRIPE_AUTOMATIC_TAX: "",
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "sb_secret_fake",
  APP_URL: "https://jobassist.example",
  ULTIMATE_EVALUATOR_MODEL: "",
  DEV_PLAN: "",
});

const { billingStatus } = await import("../src/config.js");
const { _setStripeClient, _resetPriceCache } = await import("../src/services/stripe.service.js");
const { _setSupabaseFetch } = await import("../src/services/supabaseAdmin.js");
const { resolvePlan, _resetPlanCache } = await import("../src/services/plan.service.js");
const billing = await import("../src/controllers/billing.controller.js");
const { startInterview } = await import("../src/controllers/interview.controller.js");
const { getProgressThemes } = await import("../src/controllers/progress.controller.js");
const { PLANS } = await import("../src/plans.js");
const { usageFor } = await import("../src/services/usage.service.js");

test.after(() => rm(dir, { recursive: true, force: true }));

const USER = "11111111-2222-4333-8444-555555555555";
const OWNER = "u-11111111222243338444555555555555";

/* --- fake Supabase ---------------------------------------------------------- */

const rows = new Map(); // user_id → row
_setSupabaseFetch(async (url, init = {}) => {
  const u = new URL(url);
  const json = (body, status = 200) => ({
    ok: status < 400,
    status,
    text: async () => JSON.stringify(body),
  });
  assert.equal(init.headers.apikey, "sb_secret_fake");
  assert.equal(init.headers.Authorization, undefined, "an sb_secret key is not a JWT");
  if (init.method === "GET") {
    const byUser = u.searchParams.get("user_id")?.replace(/^eq\./, "");
    const byCustomer = u.searchParams.get("stripe_customer_id")?.replace(/^eq\./, "");
    const found = [...rows.values()].filter(
      (r) => (byUser && r.user_id === byUser) || (byCustomer && r.stripe_customer_id === byCustomer)
    );
    return json(found);
  }
  if (init.method === "POST") {
    const body = JSON.parse(init.body);
    const merged = { plan: "regular", ...(rows.get(body.user_id) || {}), ...body };
    rows.set(body.user_id, merged);
    return json([merged], 201);
  }
  return json({ message: "unexpected" }, 500);
});

/* --- fake Stripe (real webhook signing) ------------------------------------ */

const realStripe = new Stripe("sk_test_unused");
const stripeState = {
  customers: new Map(),
  subscriptions: [], // { customer, ...subscription }
  prices: {
    price_proM: { id: "price_proM", active: true, type: "recurring", unit_amount: 900, currency: "cad", recurring: { interval: "month", interval_count: 1 }, tax_behavior: "exclusive" },
    price_proY: { id: "price_proY", active: true, type: "recurring", unit_amount: 9000, currency: "cad", recurring: { interval: "year", interval_count: 1 }, tax_behavior: "exclusive" },
    price_ultM: { id: "price_ultM", active: false, type: "recurring", unit_amount: 1900, currency: "cad", recurring: { interval: "month", interval_count: 1 } },
  },
  checkoutCalls: [],
  customerCalls: [],
};
let nextId = 1;
_setStripeClient({
  webhooks: realStripe.webhooks,
  prices: { retrieve: async (id) => stripeState.prices[id] },
  customers: {
    create: async (params, opts) => {
      stripeState.customerCalls.push({ params, opts });
      const c = { id: `cus_test${nextId++}`, ...params };
      stripeState.customers.set(c.id, c);
      return c;
    },
    retrieve: async (id) => stripeState.customers.get(id) ?? { id, deleted: true },
  },
  subscriptions: {
    list: async ({ customer }) => ({
      data: stripeState.subscriptions.filter((s) => s.customer === customer),
      has_more: false,
    }),
  },
  checkout: {
    sessions: {
      create: async (params) => {
        stripeState.checkoutCalls.push(params);
        return { id: "cs_test_1", url: "https://checkout.stripe.com/c/pay/cs_test_1" };
      },
    },
  },
  billingPortal: {
    sessions: { create: async ({ customer }) => ({ url: `https://billing.stripe.com/p/session/${customer}` }) },
  },
});

/* --- helpers ------------------------------------------------------------------ */

function mockRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    end() {
      return this;
    },
  };
}

async function call(handler, req) {
  const res = mockRes();
  let error;
  await handler({ get: () => undefined, ...req }, res, (err) => {
    error = err;
  });
  if (error) {
    res.statusCode = Number(error.status) || 500;
    res.body = { error: error.message };
  }
  return res;
}

function signedWebhook(event) {
  const payload = JSON.stringify(event);
  const header = realStripe.webhooks.generateTestHeaderString({
    payload,
    secret: "whsec_test_secret",
  });
  return {
    body: Buffer.from(payload),
    get: (name) => (name.toLowerCase() === "stripe-signature" ? header : undefined),
  };
}

function subscription(overrides = {}) {
  return {
    id: "sub_test1",
    customer: "cus_test1",
    status: "active",
    created: 1_700_000_000,
    cancel_at: null,
    cancel_at_period_end: false,
    items: {
      data: [
        {
          current_period_end: 1_800_000_000,
          price: { id: "price_proM", recurring: { interval: "month" }, metadata: {} },
        },
      ],
    },
    ...overrides,
  };
}

/* --- tests -------------------------------------------------------------------- */

test("billing is on only when every piece is configured", () => {
  const status = billingStatus();
  assert.equal(status.enabled, true, status.missing.join(", "));
});

test("the public catalog shows Stripe's prices, and drops an archived one", async () => {
  _resetPriceCache();
  const res = await call(billing.getPlanCatalog, {});
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.enabled, true);
  assert.deepEqual(res.body.prices.pro.month, { amount: 900, currency: "CAD", taxBehavior: "exclusive" });
  assert.equal(res.body.prices.pro.year.amount, 9000);
  assert.equal(res.body.prices.ultimate.month, null, "archived price isn't offered");
  assert.equal(res.body.prices.ultimate.year, null, "unset price isn't offered");
  assert.equal(res.body.strongerEvaluator, false, "no evaluator model configured → not advertised");
});

test("checkout: creates one customer for the user, then a compliant subscription session", async () => {
  const req = { userId: USER, userEmail: "a@example.com", clientId: OWNER, body: { plan: "pro", interval: "month" } };
  const res = await call(billing.startCheckout, req);
  assert.equal(res.statusCode, 200);
  assert.match(res.body.url, /^https:\/\/checkout\.stripe\.com\//);

  assert.equal(stripeState.customerCalls.length, 1);
  assert.equal(stripeState.customerCalls[0].params.metadata.user_id, USER);
  assert.match(stripeState.customerCalls[0].opts.idempotencyKey, new RegExp(USER));
  assert.equal(rows.get(USER).stripe_customer_id, "cus_test1");

  const params = stripeState.checkoutCalls.at(-1);
  assert.equal(params.mode, "subscription");
  assert.equal(params.customer, "cus_test1");
  assert.equal(params.client_reference_id, USER);
  assert.deepEqual(params.line_items, [{ price: "price_proM", quantity: 1 }]);
  assert.deepEqual(params.consent_collection, { terms_of_service: "required" });
  assert.match(params.custom_text.submit.message, /renews automatically every month/);
  assert.match(params.custom_text.submit.message, /Cancel any time/);
  assert.match(params.custom_text.terms_of_service_acceptance.message, /jobassist\.example\/terms/);
  assert.match(params.success_url, /^https:\/\/jobassist\.example\/plans\?checkout=success/);
  assert.equal(params.cancel_url, "https://jobassist.example/plans?checkout=cancelled");
  assert.equal("payment_method_types" in params, false, "dynamic payment methods");
  assert.equal("automatic_tax" in params, false, "tax only when STRIPE_AUTOMATIC_TAX=true");
  assert.equal(params.subscription_data.metadata.user_id, USER);

  // A second checkout reuses the customer.
  await call(billing.startCheckout, req);
  assert.equal(stripeState.customerCalls.length, 1);
});

test("checkout refuses unknown plans, unsold intervals and archived prices", async () => {
  const base = { userId: USER, userEmail: "a@example.com", clientId: OWNER };
  assert.equal((await call(billing.startCheckout, { ...base, body: { plan: "regular" } })).statusCode, 400);
  assert.equal((await call(billing.startCheckout, { ...base, body: { plan: "gold" } })).statusCode, 400);
  assert.equal(
    (await call(billing.startCheckout, { ...base, body: { plan: "ultimate", interval: "year" } })).statusCode,
    400
  );
  assert.equal(
    (await call(billing.startCheckout, { ...base, body: { plan: "ultimate", interval: "month" } })).statusCode,
    503
  );
});

test("a webhook with a bad signature is rejected and changes nothing", async () => {
  const req = signedWebhook({ id: "evt_1", type: "customer.subscription.updated", data: { object: { customer: "cus_test1" } } });
  const tampered = { ...req, body: Buffer.from(req.body.toString().replace("cus_test1", "cus_evil")) };
  const res = await call(billing.stripeWebhook, tampered);
  assert.equal(res.statusCode, 400);
  assert.equal(rows.get(USER).plan, "regular");

  const unsigned = await call(billing.stripeWebhook, { body: req.body, get: () => undefined });
  assert.equal(unsigned.statusCode, 400);
});

test("a signed subscription event grants the plan Stripe says — from Stripe, not the payload", async () => {
  _resetPlanCache();
  assert.equal((await resolvePlan(USER)).plan.id, "regular");

  stripeState.subscriptions = [subscription()];
  // The event's own object claims Ultimate; the handler must ignore it and
  // re-read the customer's subscriptions from Stripe (which say Pro).
  const res = await call(
    billing.stripeWebhook,
    signedWebhook({
      id: "evt_2",
      type: "customer.subscription.updated",
      data: { object: { customer: "cus_test1", items: { data: [{ price: { id: "price_ultM" } }] } } },
    })
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.handled, true);

  const row = rows.get(USER);
  assert.equal(row.plan, "pro");
  assert.equal(row.status, "active");
  assert.equal(row.billing_interval, "month");
  assert.equal(row.stripe_subscription_id, "sub_test1");
  assert.equal(row.current_period_end, new Date(1_800_000_000 * 1000).toISOString());
  // The plan cache was cleared, so the upgrade applies to the next request.
  assert.equal((await resolvePlan(USER)).plan.id, "pro");
});

test("checkout is refused once the user is on a paid plan", async () => {
  const res = await call(billing.startCheckout, {
    userId: USER,
    userEmail: "a@example.com",
    clientId: OWNER,
    body: { plan: "ultimate", interval: "month" },
  });
  assert.equal(res.statusCode, 409);
  assert.match(res.body.error, /Manage billing/);
});

test("the billing portal opens for a customer, and not for someone who never subscribed", async () => {
  const ok = await call(billing.openPortal, { userId: USER, clientId: OWNER });
  assert.equal(ok.statusCode, 200);
  assert.match(ok.body.url, /cus_test1/);

  const none = await call(billing.openPortal, {
    userId: "99999999-2222-4333-8444-555555555555",
    clientId: "u-99999999222243338444555555555555",
  });
  assert.equal(none.statusCode, 404);
});

test("cancellation: scheduled keeps access; deleted moves back to Regular", async () => {
  stripeState.subscriptions = [subscription({ cancel_at_period_end: true })];
  await call(
    billing.stripeWebhook,
    signedWebhook({ id: "evt_3", type: "customer.subscription.updated", data: { object: { customer: "cus_test1" } } })
  );
  assert.equal(rows.get(USER).plan, "pro");
  assert.ok(rows.get(USER).cancel_at);

  stripeState.subscriptions = [subscription({ status: "canceled" })];
  await call(
    billing.stripeWebhook,
    signedWebhook({ id: "evt_4", type: "customer.subscription.deleted", data: { object: { customer: "cus_test1" } } })
  );
  assert.equal(rows.get(USER).plan, "regular");
  assert.equal(rows.get(USER).status, "canceled");
  assert.equal((await resolvePlan(USER)).plan.id, "regular");
});

test("events for customers this app didn't create, and unhandled types, are acknowledged and ignored", async () => {
  const stranger = await call(
    billing.stripeWebhook,
    signedWebhook({ id: "evt_5", type: "invoice.paid", data: { object: { customer: "cus_unknown" } } })
  );
  assert.equal(stranger.statusCode, 200);
  assert.equal([...rows.values()].some((r) => r.stripe_customer_id === "cus_unknown"), false);

  const other = await call(
    billing.stripeWebhook,
    signedWebhook({ id: "evt_6", type: "product.updated", data: { object: {} } })
  );
  assert.equal(other.statusCode, 200);
  assert.equal(other.body.handled, false);
});

test("GET /billing/me reports the plan, limits and today's usage", async () => {
  const res = await call(billing.getMyBilling, {
    userId: USER,
    clientId: OWNER,
    plan: PLANS.regular,
    planSource: "billing",
    subscriptionRow: rows.get(USER),
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.enabled, true);
  assert.equal(res.body.enforced, true);
  assert.equal(res.body.plan, "regular");
  assert.equal(res.body.limits.speakMode, false);
  assert.deepEqual(res.body.usage.interviews, { used: 0, limit: 3 });
  assert.equal(res.body.subscription.status, "canceled");
  assert.equal(res.body.subscription.hasBillingAccount, true);
  assert.ok(res.body.resetsAt > Date.now());
});

/* --- plan limits on the feature endpoints ------------------------------------ */

const JD = "Frontend Engineer — build accessible React components for our design system.";

test("interview start: Regular can't use speak mode, a Pro-only focus or 5+ questions", async () => {
  for (const body of [
    { jobDescription: JD, mode: "speak" },
    { jobDescription: JD, focus: "system-design" },
    { jobDescription: JD, questionCount: 6 },
  ]) {
    const res = await call(startInterview, { body, plan: PLANS.regular, clientId: OWNER });
    assert.equal(res.statusCode, 403, JSON.stringify(body));
    assert.equal(res.body.code, "plan_feature");
    assert.equal(res.body.requiredPlan, "pro");
  }
  // Nothing was counted for a refused setup.
  assert.equal((await usageFor(OWNER)).interviews, 0);
});

test("interview start: a failed first question refunds the interview it reserved", async () => {
  // OPENROUTER_API_KEY is empty, so the model call fails after the quota is taken.
  const res = await call(startInterview, {
    body: { jobDescription: JD },
    plan: PLANS.regular,
    clientId: OWNER,
  });
  assert.equal(res.statusCode, 500);
  assert.equal((await usageFor(OWNER)).interviews, 0);
});

test("interview start: a used-up daily allowance is a 429 with the plan code", async () => {
  const { reserveUsage } = await import("../src/services/usage.service.js");
  const owner = "u-quota0000000000000000000000000000";
  for (let i = 0; i < 3; i += 1) await reserveUsage(owner, "interviews", 3);
  const res = await call(startInterview, {
    body: { jobDescription: JD },
    plan: PLANS.regular,
    clientId: owner,
  });
  assert.equal(res.statusCode, 429);
  assert.equal(res.body.code, "plan_quota");
  assert.match(res.body.error, /all 3 interviews included in Regular/);
});

test("recurring feedback is refused on Regular before any work is done", async () => {
  const res = await call(getProgressThemes, {
    body: { roleKey: "frontend engineer" },
    plan: PLANS.regular,
    clientId: OWNER,
  });
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.feature, "progressInsights");
});
