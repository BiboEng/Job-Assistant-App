/**
 * The three plans as the client shows them: the limits (a mirror of
 * server/src/plans.js — client/test/plans.test.js fails if they drift), the
 * names and one-line pitches, and the rows of the comparison table.
 *
 * The server is what enforces every limit; this module only describes them.
 * Prices are NOT here: they're read from Stripe through GET /api/billing/plans,
 * so the amount on the page is always the amount Checkout charges.
 */

export const PLAN_ORDER = ["regular", "pro", "ultimate"];
export const PAID_PLANS = ["pro", "ultimate"];

const ALL_FOCUSES = ["mixed", "behavioral", "technical", "system-design"];
const ALL_EXPORTS = ["pdf-print", "pdf", "jpg", "png", "txt"];

// Keep in step with PLANS in server/src/plans.js.
export const PLAN_LIMITS = {
  regular: {
    interviewsPerDay: 3,
    maxQuestions: 4,
    focuses: ["mixed", "behavioral"],
    speakMode: false,
    jobSearchesPerDay: 1,
    resumeMessagesPerDay: 20,
    exports: ["pdf-print", "txt"],
    progressInsights: false,
    trackerCards: 15,
    historyVisible: 10,
    strongerEvaluator: false,
  },
  pro: {
    interviewsPerDay: 15,
    maxQuestions: 6,
    focuses: ALL_FOCUSES,
    speakMode: true,
    jobSearchesPerDay: 5,
    resumeMessagesPerDay: 100,
    exports: ALL_EXPORTS,
    progressInsights: true,
    trackerCards: null,
    historyVisible: 100,
    strongerEvaluator: false,
  },
  ultimate: {
    interviewsPerDay: 40,
    maxQuestions: 6,
    focuses: ALL_FOCUSES,
    speakMode: true,
    jobSearchesPerDay: 15,
    resumeMessagesPerDay: 300,
    exports: ALL_EXPORTS,
    progressInsights: true,
    trackerCards: null,
    historyVisible: 100,
    strongerEvaluator: true,
  },
};

export const PLAN_COPY = {
  regular: { name: "Regular", pitch: "Everything, in small daily doses." },
  pro: { name: "Pro", pitch: "For an active job search." },
  ultimate: { name: "Ultimate", pitch: "For the weeks before the interview." },
};

export function planName(id) {
  return PLAN_COPY[id]?.name ?? "Regular";
}

const FOCUS_NAMES = {
  mixed: "Mixed",
  behavioral: "Behavioral",
  technical: "Technical",
  "system-design": "System design",
};

/**
 * The comparison table, one row per line of the plan description.
 * `evaluator` says whether the server actually has a stronger model
 * configured for Ultimate — without one, that row isn't shown, because the
 * page mustn't advertise something the plan doesn't deliver.
 * @returns {Array<{ label: string, values: Record<string, string|boolean> }>}
 */
export function comparisonRows({ evaluator = true } = {}) {
  const row = (label, fn) => ({
    label,
    values: Object.fromEntries(PLAN_ORDER.map((id) => [id, fn(PLAN_LIMITS[id])])),
  });
  const rows = [
    row("Mock interviews per day", (p) => String(p.interviewsPerDay)),
    row("Questions per interview", (p) => `2-${p.maxQuestions}`),
    row("Interview focus", (p) =>
      p.focuses.length === ALL_FOCUSES.length
        ? "All four"
        : p.focuses.map((f) => FOCUS_NAMES[f]).join(", ")
    ),
    row("Speak mode (camera, pace, pauses)", (p) => p.speakMode),
    row("Job Matches searches per day", (p) => String(p.jobSearchesPerDay)),
    row("Resume Builder AI messages per day", (p) => String(p.resumeMessagesPerDay)),
    row("Resume exports", (p) =>
      p.exports.length === ALL_EXPORTS.length ? "All formats" : "Print PDF, text"
    ),
    row("Progress", (p) =>
      p.progressInsights ? "Trend, answer quality, recurring feedback" : "Overall score trend"
    ),
    row("Application Tracker", (p) =>
      p.trackerCards == null ? "Unlimited" : `Up to ${p.trackerCards} cards`
    ),
    row("Saved interview history", (p) => `${p.historyVisible} most recent`),
  ];
  if (evaluator) {
    rows.push(row("Feedback model", (p) => (p.strongerEvaluator ? "Stronger model" : "Standard")));
  }
  return rows;
}

/** The three or four lines each plan card leads with. */
export function planHighlights(id, { evaluator = true } = {}) {
  const p = PLAN_LIMITS[id];
  if (id === "regular") {
    return [
      `${p.interviewsPerDay} mock interviews a day, typed`,
      `${p.jobSearchesPerDay} Job Matches search a day`,
      `${p.resumeMessagesPerDay} Resume Builder messages a day`,
      `Your ${p.historyVisible} most recent interviews`,
    ];
  }
  const lines = [
    `${p.interviewsPerDay} mock interviews a day, typed or spoken`,
    `${p.jobSearchesPerDay} Job Matches searches a day`,
    `${p.resumeMessagesPerDay} Resume Builder messages a day`,
    "Answer-quality trends and recurring feedback",
  ];
  if (id === "ultimate" && evaluator) lines.push("Feedback from a stronger AI model");
  return lines;
}

/**
 * A Stripe amount (minor units) → "$9" / "$9.50", in the price's currency,
 * with the currency code shown so CAD and USD can't be confused.
 * @param {{ amount: number, currency: string } | null} price
 */
export function formatPrice(price) {
  if (!price || !Number.isFinite(price.amount) || !price.currency) return null;
  const major = price.amount / 100;
  const whole = Number.isInteger(major);
  try {
    const text = new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: price.currency,
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(major);
    return `${text} ${price.currency}`;
  } catch {
    return `${major.toFixed(2)} ${price.currency}`;
  }
}

/**
 * What the price means for tax, from the Price's tax behaviour — but only when
 * the server collects tax at all (`automaticTax`). Without Stripe Tax nothing
 * is added at checkout, so "plus tax" would promise a charge that never comes.
 */
export function taxNote(price, { automaticTax = false } = {}) {
  if (!price || !automaticTax) return "";
  return price.taxBehavior === "inclusive"
    ? "Tax included where it applies"
    : "Plus applicable tax, calculated at checkout";
}

/** Yearly price as a per-month figure, and the saving against 12 × monthly. */
export function yearlySaving(monthly, yearly) {
  if (!monthly || !yearly || monthly.currency !== yearly.currency) return null;
  const full = monthly.amount * 12;
  if (yearly.amount >= full) return null;
  return Math.round(((full - yearly.amount) / full) * 100);
}
