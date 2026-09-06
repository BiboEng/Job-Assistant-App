import { timingSafeEqual } from "node:crypto";
import { config } from "../config.js";

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * Optional shared-secret gate. When API_TOKEN is unset the API is open (fine for
 * a machine only you can reach); once set, every guarded route needs
 * `Authorization: Bearer <API_TOKEN>`.
 */
export function requireApiToken(req, res, next) {
  if (!config.apiToken) return next();

  const header = req.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (token && safeEqual(token, config.apiToken)) return next();

  return res.status(401).json({ error: "Missing or invalid API token." });
}

/**
 * Reads the caller's opaque client id (set by the browser, persisted in
 * localStorage). It scopes saved history so one browser can't list, open, or
 * delete another's interviews. Not a cryptographic identity — it's the same
 * unguessable-token model the session ids already use — but it keeps honest
 * clients isolated. Pair it with API_TOKEN to actually lock the API down.
 */
export function attachClientId(req, _res, next) {
  const raw = (req.get("x-client-id") || "").trim();
  req.clientId = /^[A-Za-z0-9_-]{8,64}$/.test(raw) ? raw : null;
  next();
}

/**
 * 404 (not 403 — don't confirm the row exists) on a cross-owner access.
 *
 * Fails closed: once a session has an owner, the caller MUST present the
 * matching client id. A request with a missing or malformed `X-Client-Id`
 * (`req.clientId == null`) is rejected too, so the owner check can't be bypassed
 * by simply omitting the header.
 */
export function assertOwner(session, req) {
  if (!session?.ownerId) return; // un-owned (e.g. created without a client id)
  if (req.clientId && session.ownerId === req.clientId) return;

  const err = new Error("Session not found or expired.");
  err.status = 404;
  err.expose = true;
  throw err;
}
