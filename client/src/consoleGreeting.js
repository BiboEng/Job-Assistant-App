/**
 * A hello for anyone who opens the browser console: the Jobuddy mascot in
 * ASCII, in the app's mint. Logged once per page load from main.jsx.
 *
 * The art is plain ASCII on purpose (no box-drawing or emoji), so it lines up
 * in every console's monospace font. client/test/consoleGreeting.test.js
 * keeps it that way.
 */

export const MASCOT_ASCII = [
  "            __",
  "           (_ `.",
  "        .-'''''''-.",
  "      .'  .-----.  '.",
  "  [==|   |  ^ ^  |   |==]",
  "  [==|   |   v   |   |==]",
  "      '.  '-----'  .'-.",
  "        '-._____.-'   o",
  "         |  \\ /  |",
  "         |___V___|",
].join("\n");

export const GREETING =
  "Hi, I'm Jobuddy. Looking under the hood? Good instinct. Interviewers love curiosity.";

let greeted = false;

export function greetConsole() {
  if (greeted || typeof window === "undefined" || typeof console === "undefined") return;
  greeted = true;
  let mint = "";
  try {
    mint = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
  } catch {
    // No styles yet: the console's default colour is fine.
  }
  const colour = mint ? `color: ${mint};` : "";
  console.log(`%c${MASCOT_ASCII}`, `${colour} font-family: monospace; line-height: 1.2;`);
  console.log(`%c${GREETING}`, `${colour} font-weight: 600;`);
}
