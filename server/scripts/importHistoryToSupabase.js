// One-off: copy a flat-file history (interviews.json) into Supabase's
// public.interview_history. Safe to re-run: rows are keyed on their id, and
// ones already there are skipped.
//
//   cd server
//   node scripts/importHistoryToSupabase.js [path/to/interviews.json]
//
// Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in server/.env, and the
// migration supabase/migrations/20261123120000_interview_history.sql applied.
// The default path is <DATA_DIR>/interviews.json.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { DATA_DIR } from "../src/services/dataDir.js";
import { supabaseAdminConfigured, supabaseRest } from "../src/services/supabaseAdmin.js";
import { recordToRow } from "../src/services/historyRecord.js";

const BATCH = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const file = process.argv[2] || join(DATA_DIR, "interviews.json");

if (!supabaseAdminConfigured()) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in server/.env first.");
  process.exit(1);
}

let records;
try {
  records = JSON.parse(await readFile(file, "utf8"));
} catch (err) {
  console.error(`Couldn't read ${file}: ${err.message}`);
  process.exit(1);
}
if (!Array.isArray(records)) {
  console.error(`${file} isn't a JSON array of interviews.`);
  process.exit(1);
}

const usable = records.filter(
  (r) => r && UUID.test(String(r.id)) && r.ownerId && typeof r.jobDescription === "string"
);
const skipped = records.length - usable.length;

for (let i = 0; i < usable.length; i += BATCH) {
  const rows = usable.slice(i, i + BATCH).map(recordToRow);
  await supabaseRest("interview_history", "?on_conflict=id", {
    method: "POST",
    prefer: "resolution=ignore-duplicates,return=minimal",
    body: JSON.stringify(rows),
  });
  console.log(`Imported ${Math.min(i + BATCH, usable.length)} of ${usable.length}`);
}

console.log(
  `Done: ${usable.length} interview(s) sent from ${file}` +
    (skipped ? `, ${skipped} unusable record(s) skipped.` : ".")
);
