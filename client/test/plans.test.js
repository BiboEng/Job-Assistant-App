import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  PLAN_LIMITS,
  PLAN_ORDER,
  comparisonRows,
  formatPrice,
  planHighlights,
  taxNote,
  yearlySaving,
} from "../src/billing/plans.js";
import { PLANS, PLAN_IDS } from "../../server/src/plans.js";
import { PATHS } from "../src/routes.js";
import { missingBusinessDetails } from "../src/legal/business.js";
import { privacyDocument, refundDocument, termsDocument } from "../src/legal/documents.js";

/**
 * The client describes the plans; the server enforces them. These keep the
 * two — and the Supabase trigger that caps Tracker cards — saying the same
 * thing, so the pricing page can never promise a limit the server doesn't
 * apply (or hide one it does).
 */

const read = (rel) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8").split("\r\n").join("\n");

test("the client's plan limits mirror server/src/plans.js exactly", () => {
  assert.deepEqual(PLAN_ORDER, PLAN_IDS);
  for (const id of PLAN_IDS) {
    for (const [key, value] of Object.entries(PLAN_LIMITS[id])) {
      assert.deepEqual(value, PLANS[id][key], `${id}.${key} drifted from the server`);
    }
  }
});

test("the Tracker trigger caps Regular at the same number of cards", () => {
  const sql = read("../../supabase/migrations/20260930120000_user_subscriptions.sql");
  const m = sql.match(/if card_count >= (\d+) then/);
  assert.ok(m, "trigger limit not found");
  assert.equal(Number(m[1]), PLANS.regular.trackerCards);
  // …and exempts every paid plan, not just one.
  assert.match(sql, /coalesce\(user_plan, 'regular'\) <> 'regular'/);
  assert.match(sql, /check \(plan in \('regular', 'pro', 'ultimate'\)\)/);
});

test("the subscriptions table is service-role only: RLS on, no policies", () => {
  const sql = read("../../supabase/migrations/20260930120000_user_subscriptions.sql");
  assert.match(sql, /alter table public\.user_subscriptions enable row level security/);
  assert.doesNotMatch(sql, /create policy[^;]*user_subscriptions/i);
});

test("the paths Stripe sends people back to exist in the router", () => {
  const stripe = read("../../server/src/services/stripe.service.js");
  for (const path of [PATHS.plans, PATHS.terms, PATHS.refunds]) {
    assert.ok(stripe.includes(`\${appUrl}${path}`) || stripe.includes(`appUrl}${path}`), `${path} not used by Stripe service`);
  }
  const app = read("../src/App.jsx");
  for (const key of ["plans", "terms", "privacy", "refunds", "pricing"]) {
    assert.match(app, new RegExp(`PATHS\\.${key}\\b`), `no route for PATHS.${key}`);
  }
});

test("the comparison table covers every line of the plan description", () => {
  const labels = comparisonRows().map((r) => r.label);
  for (const expected of [
    "Mock interviews per day",
    "Questions per interview",
    "Interview focus",
    "Speak mode (camera, pace, pauses)",
    "Job Matches searches per day",
    "Resume Builder AI messages per day",
    "Resume exports",
    "Progress",
    "Application Tracker",
    "Saved interview history",
    "Feedback model",
  ]) {
    assert.ok(labels.includes(expected), `missing row: ${expected}`);
  }
  const rows = Object.fromEntries(comparisonRows().map((r) => [r.label, r.values]));
  assert.deepEqual(rows["Mock interviews per day"], { regular: "3", pro: "15", ultimate: "40" });
  assert.deepEqual(rows["Speak mode (camera, pace, pauses)"], { regular: false, pro: true, ultimate: true });
  assert.equal(rows["Interview focus"].regular, "Mixed, Behavioral");
  assert.equal(rows["Application Tracker"].regular, "Up to 15 cards");
});

test("the stronger feedback model is only advertised when it's configured", () => {
  const without = comparisonRows({ evaluator: false }).map((r) => r.label);
  assert.ok(!without.includes("Feedback model"));
  assert.ok(!planHighlights("ultimate", { evaluator: false }).some((l) => /stronger/i.test(l)));
  assert.ok(planHighlights("ultimate", { evaluator: true }).some((l) => /stronger/i.test(l)));
});

test("prices show their currency, and tax is only mentioned when it's collected", () => {
  assert.match(formatPrice({ amount: 900, currency: "CAD" }), /9.*CAD$/);
  assert.match(formatPrice({ amount: 950, currency: "USD" }), /9\.50.*USD$/);
  assert.equal(formatPrice(null), null);
  assert.equal(taxNote({ amount: 900, currency: "CAD", taxBehavior: "exclusive" }), "");
  assert.match(
    taxNote({ amount: 900, currency: "CAD", taxBehavior: "exclusive" }, { automaticTax: true }),
    /calculated at checkout/
  );
  assert.equal(yearlySaving({ amount: 900, currency: "CAD" }, { amount: 9000, currency: "CAD" }), 17);
  assert.equal(yearlySaving({ amount: 900, currency: "CAD" }, { amount: 10800, currency: "CAD" }), null);
  assert.equal(yearlySaving({ amount: 900, currency: "CAD" }, { amount: 9000, currency: "USD" }), null);
});

test("legal documents build, and name what's still missing before real sales", () => {
  for (const build of [termsDocument, privacyDocument, refundDocument]) {
    const doc = build();
    assert.ok(doc.title && doc.sections.length > 0);
  }
  assert.deepEqual(
    missingBusinessDetails({ legalName: "A B", province: "Ontario", mailingAddress: "1 St", contactEmail: "x@y.z" }),
    []
  );
  assert.ok(missingBusinessDetails({ legalName: "", province: "", mailingAddress: "", contactEmail: "" }).length === 4);
});

test("the refund policy promises the 14-day refund the checkout dialog and Stripe text mention", () => {
  const text = JSON.stringify(refundDocument());
  assert.match(text, /within 14 days of the first payment/);
  const dialog = read("../src/components/CheckoutDialog.jsx");
  assert.match(dialog, /within 14 days of your first payment/);
});
