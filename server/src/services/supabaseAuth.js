import {
  createHmac,
  createPublicKey,
  timingSafeEqual,
  verify as verifySignature,
} from "node:crypto";

/**
 * Verifies the Supabase access token the browser sends, so the API can know
 * WHO is calling rather than taking an owner id on faith from a header.
 *
 * Dependency-free (node:crypto only). Supports what Supabase issues:
 *   - ES256 / RS256, checked against the project's public JWKS
 *     (`<SUPABASE_URL>/auth/v1/.well-known/jwks.json`) — the default for
 *     projects on the asymmetric signing keys;
 *   - HS256, checked against SUPABASE_JWT_SECRET — legacy projects only.
 * Anything else (including `alg: none`) is rejected.
 *
 * Claims checked: signature, `exp` (required), `nbf`, `aud` ("authenticated"),
 * `iss` (the project's auth URL, when known) and a string `sub`. The public
 * anon key is itself a JWT, but it carries no `sub` and the wrong audience, so
 * it never passes as a user.
 */

const JWKS_TTL_MS = 10 * 60 * 1000;
// An unknown `kid` refetches (keys rotate), but not more often than this, so a
// stream of forged tokens with random kids can't turn into a stream of fetches.
const JWKS_REFETCH_MIN_MS = 30 * 1000;
const CLOCK_LEEWAY_S = 30;

const ALGS = {
  ES256: { hash: "sha256", kty: "EC", dsaEncoding: "ieee-p1363" },
  RS256: { hash: "sha256", kty: "RSA" },
};

function authError(message) {
  const err = new Error(message);
  err.status = 401;
  err.expose = true;
  return err;
}

function parseSegment(segment) {
  try {
    return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

/** Splits a compact JWS. Throws a 401 on anything malformed. */
export function decodeJwt(token) {
  const parts = typeof token === "string" ? token.split(".") : [];
  if (parts.length !== 3 || parts.some((p) => !p)) throw authError("Malformed token.");
  const header = parseSegment(parts[0]);
  const payload = parseSegment(parts[1]);
  if (!header || !payload || typeof payload !== "object") {
    throw authError("Malformed token.");
  }
  return {
    header,
    payload,
    signingInput: Buffer.from(`${parts[0]}.${parts[1]}`),
    signature: Buffer.from(parts[2], "base64url"),
  };
}

// --- JWKS cache --------------------------------------------------------------

let jwks = { url: "", keys: new Map(), fetchedAt: 0 };

async function defaultFetchJwks(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`JWKS responded ${res.status}`);
  return res.json();
}

let fetchJwks = defaultFetchJwks;

/** Test hook: swap the JWKS fetcher and forget cached keys. */
export function _setJwksFetcher(fn) {
  fetchJwks = fn || defaultFetchJwks;
  jwks = { url: "", keys: new Map(), fetchedAt: 0 };
}

async function loadKeys(jwksUrl) {
  const data = await fetchJwks(jwksUrl);
  const keys = new Map();
  for (const jwk of Array.isArray(data?.keys) ? data.keys : []) {
    if (!jwk?.kid) continue;
    try {
      keys.set(jwk.kid, { alg: jwk.alg, kty: jwk.kty, key: createPublicKey({ key: jwk, format: "jwk" }) });
    } catch {
      // An unusable key in the set shouldn't take the others down with it.
    }
  }
  jwks = { url: jwksUrl, keys, fetchedAt: Date.now() };
}

async function publicKeyFor(kid, jwksUrl) {
  const age = Date.now() - jwks.fetchedAt;
  const stale = jwks.url !== jwksUrl || age > JWKS_TTL_MS;
  if (stale || (!jwks.keys.has(kid) && age > JWKS_REFETCH_MIN_MS)) {
    try {
      await loadKeys(jwksUrl);
    } catch (err) {
      console.error("[auth] could not fetch Supabase JWKS:", err.message);
      // Keep serving the previous keys if we had any.
    }
  }
  return jwks.keys.get(kid) || null;
}

// --- verification ------------------------------------------------------------

/**
 * @param {string} token
 * @param {{ url?: string, jwtSecret?: string, audience?: string, now?: number }} opts
 * @returns {Promise<{ sub: string, payload: object }>}
 * @throws a user-safe 401 when the token isn't a valid, current user token.
 */
export async function verifySupabaseJwt(token, opts = {}) {
  const { url = "", jwtSecret = "", audience = "authenticated" } = opts;
  const now = Math.floor((opts.now ?? Date.now()) / 1000);
  const { header, payload, signingInput, signature } = decodeJwt(token);

  let valid = false;
  if (header.alg === "HS256") {
    if (!jwtSecret) throw authError("Unsupported token.");
    const expected = createHmac("sha256", jwtSecret).update(signingInput).digest();
    valid = expected.length === signature.length && timingSafeEqual(expected, signature);
  } else if (ALGS[header.alg]) {
    if (!url || typeof header.kid !== "string") throw authError("Unsupported token.");
    const spec = ALGS[header.alg];
    const entry = await publicKeyFor(header.kid, `${url}/auth/v1/.well-known/jwks.json`);
    if (!entry || entry.kty !== spec.kty || (entry.alg && entry.alg !== header.alg)) {
      throw authError("Unknown signing key.");
    }
    try {
      valid = verifySignature(
        spec.hash,
        signingInput,
        spec.dsaEncoding ? { key: entry.key, dsaEncoding: spec.dsaEncoding } : entry.key,
        signature
      );
    } catch {
      valid = false;
    }
  } else {
    throw authError("Unsupported token.");
  }
  if (!valid) throw authError("Invalid token signature.");

  if (typeof payload.exp !== "number" || payload.exp + CLOCK_LEEWAY_S < now) {
    throw authError("Your sign-in has expired. Sign in again.");
  }
  if (typeof payload.nbf === "number" && payload.nbf - CLOCK_LEEWAY_S > now) {
    throw authError("Token not yet valid.");
  }
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(audience)) throw authError("Token has the wrong audience.");
  if (url && payload.iss !== `${url}/auth/v1`) throw authError("Token has the wrong issuer.");
  if (typeof payload.sub !== "string" || !payload.sub) throw authError("Token has no user.");

  return { sub: payload.sub, payload };
}

/**
 * The owner id a Supabase user's history is stored under. MUST stay identical
 * to `setUserScope` in client/src/identity.js — existing history was saved
 * under exactly this string.
 */
export function ownerIdForUser(sub) {
  const clean = String(sub || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 60);
  return clean.length >= 6 ? `u-${clean}` : null;
}
