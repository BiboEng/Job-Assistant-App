import { useEffect, useState } from "react";
import Icon from "./Icon.jsx";
import { readTheme, saveTheme, applyTheme } from "../utils/theme.js";
import styles from "./ThemeToggle.module.css";

const OPTIONS = [
  { value: "light", icon: "sun", label: "Light" },
  { value: "system", icon: "monitor", label: "System" },
  { value: "dark", icon: "moon", label: "Dark" },
];

/**
 * Three-state theme control. "System" is a real option, not an absence of one —
 * a user who wants the OS to keep deciding should be able to say so after
 * having picked a fixed theme once.
 */
export default function ThemeToggle() {
  const [theme, setTheme] = useState(readTheme);

  // Re-apply on mount: index.html sets the attribute pre-paint, but this keeps
  // the meta theme-color correct if the module loaded from a warm cache.
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Following the OS means following it as it changes, not just at load.
  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  function choose(value) {
    setTheme(value);
    saveTheme(value);
  }

  return (
    <div className={styles.group} role="radiogroup" aria-label="Color theme">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={theme === o.value}
          className={`${styles.option} ${theme === o.value ? styles.active : ""}`}
          onClick={() => choose(o.value)}
          title={`${o.label} theme`}
        >
          <Icon name={o.icon} size={15} />
          <span className="sr-only">{o.label} theme</span>
        </button>
      ))}
    </div>
  );
}
