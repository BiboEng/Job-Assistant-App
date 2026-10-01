import test from "node:test";
import assert from "node:assert/strict";
import {
  knownPriceMap,
  pickEntitlement,
  planForPrice,
  sellingPriceId,
  splitPriceIds,
} from "../src/services/entitlement.js";

const PRICES = {
  pro: { month: "price_proM, price_proOld", year: "price_proY" },
  ultimate: { month: "price_ultM", year: "" },
};
const known = knownPriceMap(PRICES);

function sub({
  id = "sub_1",
  status = "active",
  price = "price_proM",
  interval = "month",
  periodEnd = 1_800_000_000,
  created = 1_700_000_000,
  cancelAt = null,
  cancelAtPeriodEnd = false,
  metadata = {},
} = {}) {
  return {
    id,
    status,
    created,
    cancel_at: cancelAt,
    cancel_at_period_end: cancelAtPeriodEnd,
    items: {
      data: [
        {
          current_period_end: periodEnd,
          price: { id: price, recurring: { interval }, metadata },
        },
      ],
    },
  };
}

test("price ids: the first listed is sold, all listed are recognised", () => {
  assert.deepEqual(splitPriceIds(" price_a , price_b,junk"), ["price_a", "price_b"]);
  assert.equal(sellingPriceId(PRICES, "pro", "month"), "price_proM");
  assert.equal(sellingPriceId(PRICES, "ultimate", "year"), "");
  assert.equal(planForPrice({ id: "price_proOld" }, known), "pro");
  assert.equal(planForPrice({ id: "price_ultM" }, known), "ultimate");
});

test("a price missing from the env still counts if it's tagged jobassist_plan", () => {
  assert.equal(planForPrice({ id: "price_new", metadata: { jobassist_plan: "ultimate" } }, known), "ultimate");
  assert.equal(planForPrice({ id: "price_new", metadata: { jobassist_plan: "platinum" } }, known), null);
  assert.equal(planForPrice({ id: "price_other" }, known), null);
});

test("no subscriptions = Regular with nothing to report", () => {
  assert.deepEqual(pickEntitlement([], known), {
    plan: "regular",
    status: null,
    interval: null,
    subscriptionId: null,
    priceId: null,
    currentPeriodEnd: null,
    cancelAt: null,
  });
});

test("active, trialing and past_due grant the plan; the period end comes from the item", () => {
  for (const status of ["active", "trialing", "past_due"]) {
    const e = pickEntitlement([sub({ status })], known);
    assert.equal(e.plan, "pro", status);
    assert.equal(e.status, status);
    assert.equal(e.interval, "month");
    assert.equal(e.currentPeriodEnd, new Date(1_800_000_000 * 1000).toISOString());
  }
});

test("canceled, unpaid, incomplete and paused don't — but the status is still reported", () => {
  for (const status of ["canceled", "unpaid", "incomplete", "incomplete_expired", "paused"]) {
    const e = pickEntitlement([sub({ status })], known);
    assert.equal(e.plan, "regular", status);
    assert.equal(e.status, status);
  }
});

test("a subscription to an unknown price grants nothing", () => {
  assert.equal(pickEntitlement([sub({ price: "price_someone_else" })], known).plan, "regular");
});

test("with two live subscriptions the higher plan wins, whatever the order", () => {
  const a = sub({ id: "sub_pro", price: "price_proM", created: 2 });
  const b = sub({ id: "sub_ult", price: "price_ultM", created: 1 });
  assert.equal(pickEntitlement([a, b], known).plan, "ultimate");
  assert.equal(pickEntitlement([b, a], known).subscriptionId, "sub_ult");
});

test("a scheduled cancellation is reported as cancelAt, and access continues until then", () => {
  const e = pickEntitlement([sub({ cancelAtPeriodEnd: true })], known);
  assert.equal(e.plan, "pro");
  assert.equal(e.cancelAt, new Date(1_800_000_000 * 1000).toISOString());

  const explicit = pickEntitlement([sub({ cancelAt: 1_750_000_000 })], known);
  assert.equal(explicit.cancelAt, new Date(1_750_000_000 * 1000).toISOString());
});

test("an ended subscription next to a live one doesn't mask it", () => {
  const ended = sub({ id: "sub_old", status: "canceled", price: "price_ultM", created: 5 });
  const live = sub({ id: "sub_new", status: "active", price: "price_proY", interval: "year", created: 1 });
  const e = pickEntitlement([ended, live], known);
  assert.equal(e.plan, "pro");
  assert.equal(e.interval, "year");
  assert.equal(e.subscriptionId, "sub_new");
});

test("older payloads with the period on the subscription still work", () => {
  const legacy = sub();
  delete legacy.items.data[0].current_period_end;
  legacy.current_period_end = 1_900_000_000;
  assert.equal(
    pickEntitlement([legacy], known).currentPeriodEnd,
    new Date(1_900_000_000 * 1000).toISOString()
  );
});
