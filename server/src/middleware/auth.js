import { timingSafeEqual } from "node:crypto";
import { config } from "../config.js";
import { ownerIdForUser, verifySupabaseJwt } from "../services/supabaseAuth.js";
import { runWithOwner } from "../services/modelBudget.js";

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

function bearer(req) {
  const header = req.get("authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

/** True when the server can verify Supabase sign-ins (see config.supabase). */
export function userAuthEnabled() {
  return Boolean(config.supabase.url || config.supabase.jwtSecret);
}

/**
 * Optional shared-secret gate. When API_TOKEN is unset the API is open to
 * anyone who can reach it; once set, every guarded route needs it in
 * `X-Api-Token`.
 *
 * `Authorization: Bearer <API_TOKEN>` is still accepted for older clients, but
 * only while user auth is off — with it on, `Authorization` carries the
 * user's Supabase access token instead.
 */
export function requireApiToken(req, res, next) {
  if (!config.apiToken) return next();

  const token = (req.get("x-api-token") || "").trim() || (userAuthEnabled() ? "" : bearer(req));
  if (token && safeEqual(token, config.apiToken)) return next();

  return res.status(401).json({ error: "Missing or invalid API token." });
}

/**
 * Legacy owner scoping: the caller's opaque client id from `X-Client-Id`,
 * taken at face value. Only used when the server can't verify sign-ins (no
 * SUPABASE_URL / SUPABASE_JWT_SECRET) — local development, mostly.
 */
export function attachClientId(req, _res, next) {
  const raw = (req.get("x-client-id") || "").trim();
  req.clientId = /^[A-Za-z0-9_-]{8,64}$/.test(raw) ? raw : null;
  next();
}

/**
 * Establishes who is calling, and scopes the rest of the request to them.
 *
 * With user auth configured, the caller must present a valid Supabase access
 * token (`Authorization: Bearer <jwt>`); `req.clientId` is derived from the
 * verified `sub`, so no caller can name someone else's history. Without it,
 * falls back to the legacy `X-Client-Id` header.
 *
 * Either way the rest of the request runs inside `runWithOwner`, which is what
 * lets the model budget enforce a per-user daily cap.
 */
export function authenticate(req, res, next) {
  const proceed = () => runWithOwner(req.clientId, next);

  if (!userAuthEnabled()) {
    return attachClientId(req, res, proceed);
  }

  const token = bearer(req);
  if (!token) {
    return res.status(401).json({ error: "Sign in to continue." });
  }

  verifySupabaseJwt(token, {
    url: config.supabase.url,
    jwtSecret: config.supabase.jwtSecret,
    audience: config.supabase.audience,
  })
    .then(({ sub }) => {
      req.userId = sub;
      req.clientId = ownerIdForUser(sub);
      if (!req.clientId) {
        return res.status(401).json({ error: "Sign in to continue." });
      }
      return proceed();
    })
    .catch((err) => {
      res.status(401).json({
        error: err?.expose ? err.message : "Sign in to continue.",
      });
    });
}

/**
 * 404 (not 403 — don't confirm the row exists) on a cross-owner access.
 *
 * Fails closed: once a session has an owner, the caller MUST present the
 * matching owner. A request with no owner (`req.clientId == null`) is
 * rejected too, so the check can't be bypassed by omitting credentials.
 */
export function assertOwner(session, req) {
  if (!session?.ownerId) return; // un-owned (e.g. created without a client id)
  if (req.clientId && session.ownerId === req.clientId) return;

  const err = new Error("Session not found or expired.");
  err.status = 404;
  err.expose = true;
  throw err;
}
