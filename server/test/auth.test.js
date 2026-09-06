import test from "node:test";
import assert from "node:assert/strict";
import { assertOwner, attachClientId } from "../src/middleware/auth.js";

function fakeReq(clientIdHeader) {
  return {
    get: (h) => (h.toLowerCase() === "x-client-id" ? clientIdHeader : undefined),
  };
}

test("attachClientId accepts a well-formed id and rejects junk", () => {
  const ok = fakeReq("abcd1234-EFGH_5678");
  attachClientId(ok, {}, () => {});
  assert.equal(ok.clientId, "abcd1234-EFGH_5678");

  const bad = fakeReq("short");
  attachClientId(bad, {}, () => {});
  assert.equal(bad.clientId, null);

  const missing = fakeReq(undefined);
  attachClientId(missing, {}, () => {});
  assert.equal(missing.clientId, null);
});

test("assertOwner passes an un-owned session through", () => {
  assert.doesNotThrow(() => assertOwner({ ownerId: null }, { clientId: null }));
});

test("assertOwner passes the matching owner", () => {
  assert.doesNotThrow(() =>
    assertOwner({ ownerId: "abc" }, { clientId: "abc" })
  );
});

test("assertOwner fails closed on a mismatched or missing client id", () => {
  assert.throws(() => assertOwner({ ownerId: "abc" }, { clientId: "xyz" }), {
    status: 404,
  });
  assert.throws(() => assertOwner({ ownerId: "abc" }, { clientId: null }), {
    status: 404,
  });
});
