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
  function onKeyDown(e) {
    const i = options.findIndex((o) => o.value === value);
    let next = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (i + 1) % options.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp")
      next = (i - 1 + options.length) % options.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = options.length - 1;
    if (next === null) return;
    e.preventDefault();
    onChange(options[next].value);
    // Move focus with the selection so the keyboard user stays on the control.
    e.currentTarget.querySelectorAll("button")[next]?.focus();
  }

  return (
    <div
      className={`${styles.group} ${size === "sm" ? styles.sm : ""}`}
      role="radiogroup"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
    >
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
            disabled={disabled}
            className={`${styles.option} ${checked ? styles.active : ""}`}
            onClick={() => onChange(o.value)}
            title={o.hint || undefined}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
