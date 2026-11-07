/**
 * The landing hero's "Try a question": a few roles from different fields,
 * each with hand-written sample questions in the style the real interviewer
 * asks. Plain data, no model call: the API needs a signed-in user, and an
 * anonymous visitor shouldn't spend model calls. The page labels these as
 * samples.
 *
 * `board` is what the split-flap board shows: at most 17 characters (the
 * board's width, which fits a 360px phone), from the board's character set.
 * client/test/landingSamples.test.js checks both, and the copy rule.
 */

export const SAMPLE_ROLES = [
  {
    id: "frontend",
    label: "Frontend engineer",
    board: "FRONTEND ENGINEER",
    questions: [
      "Walk me through how you'd find out why a page feels slow on mid-range phones.",
      "Tell me about a time you pushed back on a design because of accessibility.",
      "How do you decide which state lives in a component and which goes global?",
    ],
  },
  {
    id: "data",
    label: "Data analyst",
    board: "DATA ANALYST",
    questions: [
      "A dashboard number dropped 20% overnight. What do you check first?",
      "Tell me about an analysis that changed a decision. What did you find?",
      "How would you explain a confidence interval to a sales manager?",
    ],
  },
  {
    id: "nurse",
    label: "Nurse",
    board: "NURSE",
    questions: [
      "Tell me about a time you noticed a patient's condition changing before anyone else did.",
      "How do you prioritise when three patients need you at once?",
      "A family member is upset about their parent's care. How do you respond?",
    ],
  },
  {
    id: "product",
    label: "Product manager",
    board: "PRODUCT MANAGER",
    questions: [
      "Engineering says your top feature will take twice as long. What do you do?",
      "Tell me about a product decision you made with incomplete data.",
      "How would you decide whether to build something only a few big customers want?",
    ],
  },
  {
    id: "accountant",
    label: "Accountant",
    board: "ACCOUNTANT",
    questions: [
      "Walk me through how you'd handle a month-end close that's running behind.",
      "Tell me about a time you found an error in someone else's numbers.",
      "How would you explain accrual accounting to a new business owner?",
    ],
  },
];

/** Where the board settles after its intro run through the roles. */
export const BOARD_FINALE = "YOUR NEXT JOB";

/** The board's intro: every sample role, then the finale. */
export const BOARD_INTRO = [...SAMPLE_ROLES.map((r) => r.board), BOARD_FINALE];

/** The board's width in tiles. */
export const BOARD_WIDTH = 17;

/*
 * What the hero mascot does when clicked: one step per click, and the click
 * after the last goes back to where he started (waving, or asking the
 * question on screen).
 */
export const MASCOT_CLICKS = [
  { pose: "positive", line: "Nice to meet you too." },
  { pose: "thinking", line: "Hmm. Shouldn't you be practising?" },
  { pose: "feedback", line: "Tip: specific beats impressive." },
  { pose: "celebrate", line: "OK, you win. Now go practise!" },
];
