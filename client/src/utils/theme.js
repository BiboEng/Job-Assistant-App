/**
 * Theme preference: "system" | "light" | "dark".
 *
 * "system" is the default and stores nothing meaningful — it removes the
 * `data-theme` attribute so index.css's `prefers-color-scheme` block decides.
 * An explicit choice stamps the attribute, which every `:root[data-theme=…]`
 * block in index.css overrides on.
 *
 * The initial value is applied by an inline script in index.html (before first
 * paint, so there's no light flash) and re-applied here on mount.
 */

const KEY = "mockInterview:theme:v1";
export const THEMES = ["system", "light", "dark"];

export function readTheme() {
  try {
    const raw = localStorage.getItem(KEY);
    return THEMES.includes(raw) ? raw : "system";
  } catch {
    return "system"; // storage blocked — follow the OS for this session
  }
}

export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === "light" || theme === "dark") {
    root.setAttribute("data-theme", theme);
  } else {
    root.removeAttribute("data-theme");
  }
  // Keep the mobile browser chrome in step with the page.
  const resolved =
    theme === "system"
      ? window.matchMedia?.("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : theme;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", resolved === "dark" ? "#101318" : "#f4f6f9");
}

export function saveTheme(theme) {
  try {
    if (theme === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch {
    // ignore — the choice just won't survive a reload
  }
  applyTheme(theme);
}
