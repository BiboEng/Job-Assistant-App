import { request } from "./client.js";

export function listInterviews() {
  return request("/interviews");
}

export function getInterview(id) {
  return request(`/interviews/${encodeURIComponent(id)}`);
}

export function saveInterview(sessionId) {
  return request("/interviews", {
    method: "POST",
    body: JSON.stringify({ sessionId }),
  });
}

export function deleteInterview(id) {
  return request(`/interviews/${encodeURIComponent(id)}`, { method: "DELETE" });
}
