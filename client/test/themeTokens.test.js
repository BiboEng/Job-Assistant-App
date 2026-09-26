import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The design-token contract, checked as text — no bundler, no DOM.
 *
 * styles/tokens.css is the single source of every visual value; module CSS
 * styles through its names. These tests catch the two ways that erodes:
 * a module reaching for a raw colour, and a rule referencing a token that no
 * longer exists (which fails silently in the browser — the property just
 * falls back to its initial value).
 */

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const read = (p) => readFileSync(p, "utf8").split("\r\n").join("\n");

const TOKENS = read(join(SRC, "styles/tokens.css"));
const INDEX = read(join(SRC, "index.css"));

// The resume sheet is paper: it must look identical in the app and in the
// exported PDF, so it is the one place allowed its own literal colours.
const PAPER = new Set(["ResumePreview.module.css", "EditableText.module.css"]);

function moduleFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...moduleFiles(full));
    else if (entry.endsWith(".module.css")) out.push(full);
  }
  return out;
}

const declared = new Set(
  [...TOKENS.matchAll(/^\s+(--[a-z0-9-]+)\s*:/gm)].map((m) => m[1])
);

test("the palette from the design brief is declared as specified", () => {
  const expected = {
    "--bg": "#070d14",
    "--surface": "#0c1622",
    "--surface-raised": "#122030",
    "--border": "#1c2e40",
    "--text": "#e3eef5",
    "--text-muted": "#7f97a8",
    "--accent": "#4fd1c5",
    "--accent-soft": "rgba(79, 209, 197, 0.12)",
    "--secondary": "#7aa7ff",
    "--good": "#5fd39a",
    "--okay": "#e3b85c",
    "--weak": "#e8787a",
  };
  for (const [name, value] of Object.entries(expected)) {
    const m = TOKENS.match(new RegExp(`^\\s+${name}:\\s*([^;]+);`, "m"));
    assert.ok(m, `${name} is not declared in tokens.css`);
    assert.equal(m[1].trim(), value, `${name} drifted from the brief`);
  }
});

test("index.css imports the tokens and declares no custom properties itself", () => {
  assert.match(INDEX, /@import\s+["']\.\/styles\/tokens\.css["']/);
  const own = [...INDEX.matchAll(/^\s+(--[a-z0-9-]+)\s*:/gm)].map((m) => m[1]);
  assert.deepEqual(own, [], `tokens declared outside tokens.css: ${own.join(", ")}`);
});

test("there is no light theme left to half-support", () => {
  for (const [name, css] of [
    ["tokens.css", TOKENS],
    ["index.css", INDEX],
  ]) {
    assert.ok(!/data-theme/.test(css), `${name} still has a data-theme block`);
    assert.ok(
      !/prefers-color-scheme/.test(css),
      `${name} still branches on prefers-color-scheme`
    );
  }
});

test("module CSS uses no raw colours", () => {
  const offenders = [];
  for (const file of moduleFiles(SRC)) {
    if (PAPER.has(file.split(/[\\/]/).pop())) continue;
    const css = read(file).replace(/\/\*[\s\S]*?\*\//g, "");
    const hit = css.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
    if (hit) offenders.push(`${file.slice(SRC.length)}: ${hit[0]}`);
  }
  assert.deepEqual(offenders, [], `raw colours in module CSS:\n${offenders.join("\n")}`);
});

test("every var(--token) referenced in CSS is declared", () => {
  const files = [join(SRC, "index.css"), ...moduleFiles(SRC)];
  const missing = new Set();
  for (const file of files) {
    for (const m of read(file).matchAll(/var\((--[a-z0-9-]+)/g)) {
      if (!declared.has(m[1])) missing.add(`${m[1]} (${file.slice(SRC.length)})`);
    }
  }
  assert.deepEqual([...missing], [], `undeclared tokens:\n${[...missing].join("\n")}`);
});
