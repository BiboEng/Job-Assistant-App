/**
 * Shared score → color/label mapping so cards, pills and the score ring stay in
 * sync. Colors are CSS custom properties (defined per-theme in index.css) so
 * they read correctly in both light and dark mode; they resolve fine when
 * applied through inline styles.
 *
 * `soft` is the tinted background that pairs with `color` — used wherever a
 * score needs to read as a filled chip rather than colored text.
 */
export function scoreBand(pct) {
  if (pct >= 75) {
    return {
      key: "strong",
      color: "var(--band-strong)",
      soft: "var(--band-strong-soft)",
      label: "Strong",
    };
  }
  if (pct >= 50) {
    return {
      key: "mixed",
      color: "var(--band-mixed)",
      soft: "var(--band-mixed-soft)",
      label: "Mixed",
    };
  }
  return {
    key: "weak",
    color: "var(--band-weak)",
    soft: "var(--band-weak-soft)",
    label: "Needs work",
  };
}

export function pctOf(score, max = 100) {
  const m = max || 100;
  return Math.max(0, Math.min(100, Math.round((score / m) * 100)));
}
