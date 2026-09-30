import { useEffect, useState } from "react";

// Matches --dur-reveal in tokens.css, so the number lands with the bar under it.
const DURATION_MS = 800;

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Counts an integer up from 0 to `target` on mount (and on each new target),
 * easing out so it slows into the final value. Display only: the true value
 * belongs in an aria-label, since a screen reader shouldn't hear it tick.
 * Reduced motion gets the final number straight away.
 */
export default function useCountUp(target, duration = DURATION_MS) {
  const [value, setValue] = useState(() => (prefersReducedMotion() ? target : 0));

  useEffect(() => {
    if (prefersReducedMotion() || !Number.isFinite(target)) {
      setValue(target);
      return undefined;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(target * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);

  return value;
}
