/** Seconds -> "m:ss" (e.g. 185 -> "3:05"). */
export function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${String(rem).padStart(2, "0")}`;
}

/**
 * A date/ISO string -> a short "posted" label ("today", "3 days ago",
 * "2 weeks ago"). Returns "" for anything unparseable.
 */
export function relativeDay(input) {
  if (!input) return "";
  const then = new Date(input).getTime();
  if (!Number.isFinite(then)) return "";

  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 14) return "1 week ago";
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  return `${Math.floor(days / 30)} months ago`;
}
