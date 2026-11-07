import { Fragment } from "react";
import styles from "./KineticText.module.css";

/**
 * A heading whose words rise one after another out of their own masks.
 *
 * `parts` is the heading as a list of strings and `{ text, accent: true }`
 * pieces (the accent ones get `accentClassName`), separated by spaces.
 *
 * `trigger="load"` plays as soon as it mounts (the landing hero).
 * `trigger="view"` marks the heading `data-reveal="words"`, so the landing
 * page's scroll observer plays it the first time it's seen. Like every reveal
 * there, nothing is hidden until that observer is attached
 * (`[data-reveal-ready]`), and reduced motion shows it all at once.
 *
 * Screen readers get the heading as one plain string; the split-up copy
 * that animates is aria-hidden.
 */
export default function KineticText({
  as: Tag = "h2",
  parts,
  trigger = "view",
  className = "",
  accentClassName = "",
  startDelay = 0,
  wordDelay = 45,
  ...rest
}) {
  const words = [];
  for (const part of parts) {
    const piece = typeof part === "string" ? { text: part, accent: false } : part;
    for (const w of piece.text.split(/\s+/).filter(Boolean)) {
      words.push({ text: w, accent: Boolean(piece.accent) });
    }
  }
  const plain = words.map((w) => w.text).join(" ");

  return (
    <Tag
      className={[styles.kinetic, trigger === "load" ? styles.onLoad : "", className]
        .filter(Boolean)
        .join(" ")}
      {...(trigger === "view" ? { "data-reveal": "words" } : {})}
      {...rest}
    >
      <span className="sr-only">{plain}</span>
      <span aria-hidden="true">
        {words.map((w, i) => (
          <Fragment key={i}>
            {i > 0 && " "}
            <span className={styles.word}>
              <span
                className={`${styles.inner} ${w.accent ? accentClassName : ""}`}
                style={{ "--reveal-delay": `${startDelay + i * wordDelay}ms` }}
              >
                {w.text}
              </span>
            </span>
          </Fragment>
        ))}
      </span>
    </Tag>
  );
}
