import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// history.service reads DATA_DIR at import time, so point it at a scratch
// directory before loading it (each test file runs in its own process).
const dir = await mkdtemp(join(tmpdir(), "mi-history-"));
process.env.DATA_DIR = dir;
const { saveInterview, listInterviews, getInterview } = await import(
  "../src/services/history.service.js"
);

test.after(() => rm(dir, { recursive: true, force: true }));

const delivery = { wpm: 150, pauseCount: 2, pauseMs: 4000, speakingMs: 40000, onCameraPct: 80 };

test("a saved interview keeps its mode, focus and each answer's delivery metrics", async () => {
  const record = await saveInterview({
    ownerId: "owner-12345678",
    jobDescription: "Frontend Engineer\nBuild things.",
    totalQuestions: 2,
    mode: "speak",
    focus: "technical",
    qaPairs: [
      { questionNumber: 1, question: "Q1?", answer: "A1", timeLimitSeconds: 60, delivery },
      { questionNumber: 2, question: "Q2?", answer: "", timeLimitSeconds: 60, delivery: null },
    ],
    feedback: { overallScore: 70 },
  });

  const stored = await getInterview(record.id, "owner-12345678");
  assert.equal(stored.mode, "speak");
  assert.equal(stored.focus, "technical");
  assert.deepEqual(stored.qaPairs[0].delivery, delivery);
  assert.equal(stored.qaPairs[1].delivery, null);

  const [row] = await listInterviews("owner-12345678");
  assert.equal(row.mode, "speak");

  const onDisk = JSON.parse(await readFile(join(dir, "interviews.json"), "utf8"));
  assert.deepEqual(onDisk[0].qaPairs[0].delivery, delivery, "persisted, not just cached");
});
