import { SURVEY_QUESTIONS } from "./surveyQuestions.js";

/**
 * Pure mapping between the form's answer shape and a `user_survey_responses`
 * row.
 *
 * No Supabase, no network, no `import.meta.env` — which is what makes it
 * testable under plain node, and is the whole reason it isn't simply part of
 * `surveyApi.js`. Importing that module outside Vite throws, because the
 * Supabase client reads `import.meta.env` at load time.
 *
 * The form works in a flat `{ column: value }` object where a skipped question
 * is the empty value for its type. The row is what Postgres wants: NULL for a
 * skipped single-select or free-text answer, and an empty array — never null —
 * for a multi-select, whose column is `not null default '{}'`.
 */

/** Every column the survey owns, derived from the questions themselves. */
function answerColumns() {
  const cols = [];
  for (const q of SURVEY_QUESTIONS) {
    cols.push(q.column);
    if (q.followUp) cols.push(q.followUp.column);
    if (q.optOut) cols.push(q.optOut.column);
  }
  return cols;
}

export const SURVEY_COLUMNS = answerColumns();

/** A blank answer set: the shape the form works in. */
export function emptyAnswers() {
  const answers = {};
  for (const q of SURVEY_QUESTIONS) {
    answers[q.column] = q.type === "multi" ? [] : "";
    if (q.followUp) answers[q.followUp.column] = "";
    if (q.optOut) answers[q.optOut.column] = false;
  }
  return answers;
}

/**
 * Row → form answers. Null columns (a skipped question) become the empty value
 * for that question's type, so the form never has to reason about null.
 */
export function rowToAnswers(row) {
  const answers = emptyAnswers();
  if (!row) return answers;
  for (const q of SURVEY_QUESTIONS) {
    const value = row[q.column];
    if (q.type === "multi") {
      answers[q.column] = Array.isArray(value) ? value : [];
    } else if (typeof value === "string") {
      answers[q.column] = value;
    }
    if (q.followUp && typeof row[q.followUp.column] === "string") {
      answers[q.followUp.column] = row[q.followUp.column];
    }
    if (q.optOut) answers[q.optOut.column] = row[q.optOut.column] === true;
  }
  return answers;
}

/**
 * Form answers → row. Trims text, drops blanks to null (so "skipped" is a NULL
 * column rather than an empty string), enforces the length caps, and discards
 * any option value the question doesn't define — the CHECK constraints would
 * reject those anyway, but failing the whole save because one stale value rode
 * along in local state is a worse outcome than dropping it.
 *
 * A follow-up field is only stored while its trigger option is selected, and
 * the salary text is cleared by the opt-out, so the row can't contradict
 * itself after someone changes their mind on a later visit.
 */
export function answersToRow(answers) {
  const row = {};
  const clean = (v, max) => {
    const s = typeof v === "string" ? v.trim() : "";
    if (!s) return null;
    return s.slice(0, max);
  };

  for (const q of SURVEY_QUESTIONS) {
    const value = answers?.[q.column];

    if (q.type === "multi") {
      const allowed = new Set(q.options.map((o) => o.value));
      const picked = Array.isArray(value) ? value.filter((v) => allowed.has(v)) : [];
      // The column is `not null default '{}'`, so an empty array — not null —
      // is how "answered nothing" is stored.
      row[q.column] = [...new Set(picked)];
    } else if (q.type === "single") {
      const allowed = new Set(q.options.map((o) => o.value));
      row[q.column] = allowed.has(value) ? value : null;
    } else {
      row[q.column] = clean(value, q.maxLength);
    }

    if (q.followUp) {
      const active = row[q.column] === q.followUp.when;
      row[q.followUp.column] = active
        ? clean(answers?.[q.followUp.column], q.followUp.maxLength)
        : null;
    }

    if (q.optOut) {
      const optedOut = answers?.[q.optOut.column] === true;
      row[q.optOut.column] = optedOut;
      if (optedOut) row[q.column] = null;
    }
  }

  return row;
}

/** True once any question has an answer — drives "save what's there on exit". */
export function hasAnyAnswer(answers) {
  const row = answersToRow(answers);
  return Object.entries(row).some(([, value]) => {
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === "boolean") return value;
    return value !== null && value !== "";
  });
}
