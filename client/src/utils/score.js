/**
 * Shared score → color/label mapping so cards and the score ring stay in sync.
 * Colors are CSS custom properties (defined per-theme in index.css) so they read
 * correctly in both light and dark mode; they resolve fine in inline styles.
 */
export function scoreBand(pct) {
  if (pct >= 75) return { color: "var(--band-strong)", label: "Strong" };
  if (pct >= 50) return { color: "var(--band-mixed)", label: "Mixed" };
  return { color: "var(--band-weak)", label: "Needs work" };
}

export function pctOf(score, max = 100) {
  const m = max || 100;
  return Math.max(0, Math.min(100, Math.round((score / m) * 100)));
}
