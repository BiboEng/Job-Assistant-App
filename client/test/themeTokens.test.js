import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * index.css declares every dark value twice, and the two copies are not
 * interchangeable:
 *
 *   @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) }
 *       -> the viewer left the theme on "system" and their OS is dark
 *   :root[data-theme="dark"]
 *       -> the viewer explicitly picked Dark from the ThemeToggle
 *
 * A token added to one and not the other is invisible in whichever of those two
 * paths you happen to be testing in. That is not hypothetical: --accent-text-hover
 * was added to the media block only, so a hovered link in the *toggle* path fell
 * back to the light-mode value and rendered at 2.0:1 on a near-black surface,
 * while OS-dark looked perfect. A plain string replace had matched the 4-space
 * media-block line, because "  --x:" is a substring of "    --x:".
 *
 * These tests are cheap and text-only — no bundler, no DOM — which is the whole
 * reason they can guard a stylesheet at all.
 */

const CSS = readFileSync(
  fileURLToPath(new URL("../src/index.css", import.meta.url)),
  "utf8"
).split("\r\n").join("\n");

/** Slice out a top-level block by brace balance, starting at a matching line. */
function blockStartingWith(prefix) {
  const lines = CSS.split("\n");
  const start = lines.findIndex((l) => l.startsWith(prefix));
  assert.notEqual(start, -1, `no top-level block starting with ${prefix}`);
  let depth = 0;
  const out = [];
  for (let i = start; i < lines.length; i++) {
    depth += (lines[i].match(/\{/g) || []).length;
    depth -= (lines[i].match(/\}/g) || []).length;
    out.push(lines[i]);
    if (depth === 0 && i > start) return out.join("\n");
  }
  throw new Error(`unbalanced braces after ${prefix}`);
}

/** Custom-property names declared anywhere inside a block. */
function declaredTokens(block) {
  return new Set([...block.matchAll(/^\s+(--[a-z0-9-]+)\s*:/gm)].map((m) => m[1]));
}

const root = blockStartingWith(":root {");
const mediaDark = blockStartingWith("@media (prefers-color-scheme: dark)");
const attrDark = blockStartingWith(':root[data-theme="dark"]');

test("both dark blocks declare exactly the same tokens", () => {
  const a = declaredTokens(mediaDark);
  const b = declaredTokens(attrDark);
  const onlyMedia = [...a].filter((t) => !b.has(t));
  const onlyAttr = [...b].filter((t) => !a.has(t));
  assert.deepEqual(
    onlyMedia,
    [],
    `declared for OS-dark but not for the Dark toggle: ${onlyMedia.join(", ")}`
  );
  assert.deepEqual(
    onlyAttr,
    [],
    `declared for the Dark toggle but not for OS-dark: ${onlyAttr.join(", ")}`
  );
});

test("every token a dark block overrides also has a light default in :root", () => {
  const base = declaredTokens(root);
  const missing = [...declaredTokens(attrDark)].filter((t) => !base.has(t));
  assert.deepEqual(
    missing,
    [],
    `dark-only tokens with no :root fallback: ${missing.join(", ")}`
  );
});

test("--accent-text is defined wherever --accent is overridden", () => {
  // The fill colour and the ink colour diverge in dark mode. A theme that
  // redefines one without the other silently reintroduces the low-contrast
  // link this split exists to prevent.
  for (const [name, block] of [
    ["media-query dark", mediaDark],
    ["data-theme dark", attrDark],
  ]) {
    const t = declaredTokens(block);
    assert.ok(
      !t.has("--accent") || t.has("--accent-text"),
      `${name} overrides --accent without --accent-text`
    );
    assert.ok(
      !t.has("--accent-text") || t.has("--accent-text-hover"),
      `${name} overrides --accent-text without --accent-text-hover`
    );
  }
});
