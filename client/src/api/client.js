import { REQUEST_TIMEOUT_MS } from "../constants.js";
import { getClientId } from "../identity.js";

const BASE = import.meta.env.VITE_API_BASE_URL || "";
const API_TOKEN = import.meta.env.VITE_API_TOKEN || "";

/**
 * Thin fetch wrapper: JSON in/out, an abort-based timeout, and normalized errors
 * (Error with an optional `.status`). Shared by every API module.
 */
export async function request(path, options = {}) {
  const { headers: extraHeaders, timeoutMs, ...rest } = options;

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    timeoutMs || REQUEST_TIMEOUT_MS
  );

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
      throw new Error("The request timed out. Please try again.");
    }
    throw new Error("Could not reach the server. Check your connection and try again.");
  } finally {
    clearTimeout(timer);
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
