import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Icon from "./Icon.jsx";
import styles from "./SegmentedControl.module.css";

/**
 * A one-click alternative to a `<select>` for short option sets.
 *
 * Used where the choice matters enough to stay visible — question count and
 * interview focus. Anything with more than about five options (countries, sort
 * orders) stays a native select, which handles long lists far better.
 *
 * Implemented as a radiogroup: arrow keys move between options, and only the
 * checked option is in the tab order, which is the expected behaviour for a
 * group of mutually exclusive choices.
 *
 * The selected fill is one element that slides to the checked option, measured
 * from its box (the group can wrap, so both axes). It appears in place on first
 * paint and only animates once it's been placed, so it never sweeps in from
 * the corner on mount.
 */
export default function SegmentedControl({
  options,
  value,
  onChange,
  name,
  ariaLabel,
  disabled = false,
  size = "md",
}) {
  const groupRef = useRef(null);
  const [box, setBox] = useState(null);
  const [animate, setAnimate] = useState(false);
  const activeIndex = options.findIndex((o) => o.value === value);

  useLayoutEffect(() => {
    const group = groupRef.current;
    if (!group) return undefined;
    const measure = () => {
      const btn = group.querySelectorAll("button")[activeIndex];
      setBox(
        btn
          ? { x: btn.offsetLeft, y: btn.offsetTop, w: btn.offsetWidth, h: btn.offsetHeight }
          : null
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(group);
    return () => ro.disconnect();
  }, [activeIndex, options.length]);

  // After the first placement has painted, switch the transition on. Turning
  // it on at an unchanged position animates nothing, so later moves slide.
  useEffect(() => {
    if (box && !animate) setAnimate(true);
  }, [box, animate]);

  // The next selectable option from `from`, stepping by `dir` — skipping any
  // that are individually disabled (e.g. locked by the plan).
  function step(from, dir) {
    for (let k = 1; k <= options.length; k += 1) {
      const idx = (from + dir * k + options.length * k) % options.length;
      if (!options[idx].disabled) return idx;
    }
    return null;
  }

  function onKeyDown(e) {
    const i = activeIndex;
    let next = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = step(i, 1);
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = step(i, -1);
    else if (e.key === "Home") next = step(-1, 1);
    else if (e.key === "End") next = step(options.length, -1);
    if (next === null) return;
    e.preventDefault();
    onChange(options[next].value);
    // Move focus with the selection so the keyboard user stays on the control.
    e.currentTarget.querySelectorAll("button")[next]?.focus();
  }

  return (
    <div
      ref={groupRef}
      className={`${styles.group} ${size === "sm" ? styles.sm : ""}`}
      role="radiogroup"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
    >
      {box && (
        <span
          aria-hidden="true"
          className={`${styles.indicator} ${animate ? styles.indicatorAnimate : ""}`}
          style={{
            width: box.w,
            height: box.h,
            transform: `translate(${box.x}px, ${box.y}px)`,
          }}
        />
      )}
      {options.map((o) => {
        const checked = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            name={name}
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            disabled={disabled || o.disabled}
            className={`${styles.option} ${checked ? styles.active : ""} ${
              o.locked ? styles.locked : ""
            }`}
            onClick={() => onChange(o.value)}
            title={o.hint || undefined}
          >
            {/* A plan lock: the option is visible (so it can be discovered)
                but not selectable. The hint says which plan includes it. */}
            {o.locked && <Icon name="lock" />}
            {o.label}
            {o.locked && <span className="sr-only"> (not in your plan)</span>}
          </button>
        );
      })}
    </div>
  );
}
