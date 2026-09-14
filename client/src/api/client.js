import { REQUEST_TIMEOUT_MS } from "../constants.js";
import { getClientId } from "../identity.js";

const BASE = import.meta.env.VITE_API_BASE_URL || "";
const API_TOKEN = import.meta.env.VITE_API_TOKEN || "";

/**
 * Thin fetch wrapper: JSON in/out, an abort-based timeout, and normalized errors
 * (Error with an optional `.status`). Shared by every API module.
 *
 * An optional caller `signal` is composed with the internal timeout signal, so a
 * caller can cancel in flight (Resume Builder's Stop button) without losing the
 * timeout. A caller-triggered abort throws an Error with `.aborted = true` —
 * distinct from the timeout message, since it isn't a failure worth showing.
 */
export async function request(path, options = {}) {
  const { headers: extraHeaders, timeoutMs, signal, ...rest } = options;

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs || REQUEST_TIMEOUT_MS);

  const onCallerAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", onCallerAbort, { once: true });
  }

  let res;
  try {
    res = await fetch(`${BASE}/api${path}`, {
      headers: {
        "Content-Type": "application/json",
        "X-Client-Id": getClientId(),
        ...(API_TOKEN ? { Authorization: `Bearer ${API_TOKEN}` } : {}),
        ...extraHeaders,
      },
      signal: controller.signal,
      ...rest,
    });
  } catch (err) {
    if (err?.name === "AbortError") {
      if (timedOut) throw new Error("The request timed out. Please try again.");
      const aborted = new Error("Request cancelled.");
      aborted.aborted = true;
      throw aborted;
    }
    throw new Error("Could not reach the server. Check your connection and try again.");
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onCallerAbort);
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    // no body
  }

  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}
