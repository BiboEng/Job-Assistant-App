import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, generateKeyPairSync, sign } from "node:crypto";
import {
  _setJwksFetcher,
  ownerIdForUser,
  verifySupabaseJwt,
} from "../src/services/supabaseAuth.js";
import { config } from "../src/config.js";
import { authenticate, requireApiToken } from "../src/middleware/auth.js";

const URL_ = "https://proj.supabase.co";
const ISS = `${URL_}/auth/v1`;
const SUB = "8f14e45f-ceea-467a-9575-8b3f2b1c1a2b";
const NOW = 1_800_000_000;

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "key-1", alg: "ES256", use: "sig" };

let fetches = 0;
function useJwks(keys = [jwk]) {
  fetches = 0;
  _setJwksFetcher(async () => {
    fetches += 1;
    return { keys };
  });
}

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");

function es256(payload, header = {}) {
  const head = b64({ alg: "ES256", typ: "JWT", kid: "key-1", ...header });
  const body = b64(payload);
  const sig = sign("sha256", Buffer.from(`${head}.${body}`), {
    key: privateKey,
    dsaEncoding: "ieee-p1363",
  }).toString("base64url");
  return `${head}.${body}.${sig}`;
}

function hs256(payload, secret) {
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64(payload);
  const sig = createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

const claims = (over = {}) => ({
  sub: SUB,
  aud: "authenticated",
  iss: ISS,
  role: "authenticated",
  exp: NOW + 3600,
  ...over,
});

const opts = { url: URL_, audience: "authenticated", now: NOW * 1000 };

test("accepts a valid ES256 user token checked against the JWKS", async () => {
  useJwks();
  const { sub } = await verifySupabaseJwt(es256(claims()), opts);
  assert.equal(sub, SUB);
});

test("rejects an expired token", async () => {
  useJwks();
  await assert.rejects(verifySupabaseJwt(es256(claims({ exp: NOW - 120 })), opts), {
    status: 401,
    message: /expired/,
  });
});

test("rejects the wrong audience, the wrong issuer, and a missing sub", async () => {
  useJwks();
  await assert.rejects(verifySupabaseJwt(es256(claims({ aud: "anon" })), opts), { status: 401 });
  await assert.rejects(
    verifySupabaseJwt(es256(claims({ iss: "https://evil.supabase.co/auth/v1" })), opts),
    { status: 401 }
  );
  await assert.rejects(verifySupabaseJwt(es256(claims({ sub: undefined })), opts), {
    status: 401,
  });
});

test("rejects a token whose payload was altered after signing", async () => {
  useJwks();
  const [h, , s] = es256(claims()).split(".");
  const forged = `${h}.${b64(claims({ sub: "someone-else-entirely" }))}.${s}`;
  await assert.rejects(verifySupabaseJwt(forged, opts), { status: 401 });
});

test("rejects alg none, unknown algs, and garbage", async () => {
  useJwks();
  const none = `${b64({ alg: "none" })}.${b64(claims())}.`;
  await assert.rejects(verifySupabaseJwt(none, opts), { status: 401 });
  const hs512 = `${b64({ alg: "HS512" })}.${b64(claims())}.abc`;
  await assert.rejects(verifySupabaseJwt(hs512, opts), { status: 401 });
  await assert.rejects(verifySupabaseJwt("not.a.jwt", opts), { status: 401 });
  await assert.rejects(verifySupabaseJwt("", opts), { status: 401 });
});

test("an unknown kid is rejected, without refetching the JWKS on every request", async () => {
  useJwks();
  await verifySupabaseJwt(es256(claims()), opts); // primes the cache
  const before = fetches;
  const token = es256(claims(), { kid: "rotated-away" });
  await assert.rejects(verifySupabaseJwt(token, opts), { status: 401 });
  await assert.rejects(verifySupabaseJwt(token, opts), { status: 401 });
  assert.equal(fetches, before, "cache is fresh, so no refetch inside the minimum interval");
});

test("HS256 is accepted only with the legacy secret configured", async () => {
  useJwks([]);
  const token = hs256(claims(), "legacy-secret");
  await assert.rejects(verifySupabaseJwt(token, opts), { status: 401 });
  const { sub } = await verifySupabaseJwt(token, { ...opts, jwtSecret: "legacy-secret" });
  assert.equal(sub, SUB);
  await assert.rejects(verifySupabaseJwt(token, { ...opts, jwtSecret: "other" }), {
    status: 401,
  });
});

test("ownerIdForUser matches the client's setUserScope format", () => {
  assert.equal(ownerIdForUser(SUB), `u-${SUB.replace(/-/g, "")}`);
  assert.equal(ownerIdForUser(""), null);
});

// --- middleware -----------------------------------------------------------

function fakeReq(headers) {
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { get: (h) => lower[h.toLowerCase()] };
}

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

function withSupabase(url, fn) {
  const saved = { ...config.supabase };
  config.supabase.url = url;
  config.supabase.jwtSecret = "";
  return Promise.resolve(fn()).finally(() => Object.assign(config.supabase, saved));
}

function runAuth(req, res) {
  return new Promise((resolve) => {
    const origJson = res.json.bind(res);
    res.json = (body) => {
      origJson(body);
      resolve("responded");
      return res;
    };
    authenticate(req, res, () => resolve("next"));
  });
}

test("authenticate scopes the request to the verified user and ignores X-Client-Id", () =>
  withSupabase(URL_, async () => {
    useJwks();
    const token = es256(claims({ exp: Math.floor(Date.now() / 1000) + 3600 }));
    const req = fakeReq({ authorization: `Bearer ${token}`, "x-client-id": "u-someoneelse123" });
    const outcome = await runAuth(req, fakeRes());
    assert.equal(outcome, "next");
    assert.equal(req.clientId, ownerIdForUser(SUB));
    assert.equal(req.userId, SUB);
  }));

test("authenticate answers 401 with no token or a bad one", () =>
  withSupabase(URL_, async () => {
    useJwks();
    const res1 = fakeRes();
    assert.equal(await runAuth(fakeReq({ "x-client-id": "u-someoneelse123" }), res1), "responded");
    assert.equal(res1.statusCode, 401);

    const res2 = fakeRes();
    assert.equal(await runAuth(fakeReq({ authorization: "Bearer nope" }), res2), "responded");
    assert.equal(res2.statusCode, 401);
  }));

test("without SUPABASE_URL, authenticate falls back to the X-Client-Id header", () =>
  withSupabase("", async () => {
    const req = fakeReq({ "x-client-id": "abcd1234-EFGH_5678" });
    assert.equal(await runAuth(req, fakeRes()), "next");
    assert.equal(req.clientId, "abcd1234-EFGH_5678");
  }));

test("requireApiToken reads X-Api-Token; Bearer is only accepted while user auth is off", async () => {
  const savedToken = config.apiToken;
  config.apiToken = "shared-token";
  try {
    const call = (headers) => {
      const res = fakeRes();
      let passed = false;
      requireApiToken(fakeReq(headers), res, () => {
        passed = true;
      });
      return passed ? "next" : res.statusCode;
    };
    await withSupabase(URL_, () => {
      assert.equal(call({ "x-api-token": "shared-token" }), "next");
      assert.equal(call({ authorization: "Bearer shared-token" }), 401);
      assert.equal(call({ "x-api-token": "wrong" }), 401);
    });
    await withSupabase("", () => {
      assert.equal(call({ authorization: "Bearer shared-token" }), "next");
    });
  } finally {
    config.apiToken = savedToken;
  }
});
