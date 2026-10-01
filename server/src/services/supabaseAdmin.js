import { config } from "../config.js";

/**
 * Server-side access to `public.user_subscriptions`, the one Supabase table the
 * API server reads and writes. Dependency-free: PostgREST over fetch.
 *
 * It authenticates with the SERVICE-ROLE key, which bypasses row-level
 * security, and that is the point: the table has RLS on with no policies at
 * all, so no browser (holding only the public anon key) can read or write a
 * plan. The only writer is the Stripe webhook handler, after Stripe has
 * signed the event. Never send this key to the client.
 *
 * Accepts both key formats Supabase issues: a legacy `service_role` JWT (sent
 * as `apikey` and as a Bearer token) and a newer `sb_secret_…` key (sent as
 * `apikey` only — it isn't a JWT).
 */

const TABLE = "user_subscriptions";
const TIMEOUT_MS = 8000;

let fetchImpl = (...args) => fetch(...args);

/** Test hook: swap the fetch used for PostgREST calls. */
export function _setSupabaseFetch(fn) {
  fetchImpl = fn || ((...args) => fetch(...args));
}

function headers(extra = {}) {
  const key = config.billing.supabaseServiceRoleKey;
  const isJwt = key.split(".").length === 3;
  return {
    apikey: key,
    ...(isJwt ? { Authorization: `Bearer ${key}` } : {}),
    "Content-Type": "application/json",
    Accept: "application/json",
    ...extra,
  };
}

function restUrl(query) {
  return `${config.supabase.url}/rest/v1/${TABLE}${query}`;
}

async function call(url, init) {
  let res;
  try {
    res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (cause) {
    const err = new Error("Could not reach the subscriptions database.");
    err.cause = cause;
    throw err;
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    const err = new Error(`Subscriptions database responded ${res.status}`);
    err.status = res.status;
    err.detail = detail.slice(0, 300);
    // A missing table is its own case: the migration hasn't been applied.
    if (/PGRST205|42P01|does not exist/i.test(detail)) err.missingTable = true;
    throw err;
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STRIPE_ID = /^[A-Za-z0-9_]{3,255}$/;

/** The subscription row for a Supabase user id, or null. */
export async function getSubscriptionRow(userId) {
  if (!UUID.test(String(userId || ""))) return null;
  const rows = await call(restUrl(`?user_id=eq.${encodeURIComponent(userId)}&select=*`), {
    method: "GET",
    headers: headers(),
  });
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

/** The subscription row holding a Stripe customer id, or null. */
export async function getSubscriptionRowByCustomer(customerId) {
  if (!STRIPE_ID.test(String(customerId || ""))) return null;
  const rows = await call(
    restUrl(`?stripe_customer_id=eq.${encodeURIComponent(customerId)}&select=*`),
    { method: "GET", headers: headers() }
  );
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

/**
 * Insert or update a user's row (keyed on `user_id`). Only the fields passed
 * are written; `updated_at` is maintained by a trigger.
 * @param {{ user_id: string } & Record<string, unknown>} row
 */
export async function upsertSubscriptionRow(row) {
  if (!UUID.test(String(row?.user_id || ""))) {
    throw new Error("upsertSubscriptionRow needs a valid user_id.");
  }
  const rows = await call(restUrl("?on_conflict=user_id"), {
    method: "POST",
    headers: headers({ Prefer: "resolution=merge-duplicates,return=representation" }),
    body: JSON.stringify(row),
  });
  return Array.isArray(rows) ? rows[0] ?? null : rows;
}
