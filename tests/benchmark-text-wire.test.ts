import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { recordEvidence } from "../scripts/evals/benchmark/benchmark-output.ts";
import { zeroWrites } from "../scripts/evals/benchmark/benchmark-cases.ts";
import type { TrialOutcome } from "../scripts/evals/benchmark/benchmark-trial.ts";

const EXPECTED_TEXT_EVENTS = 2;
const savedTraceSchema = z.object({
  textWire: z.array(
    z.object({ kind: z.enum(["request", "response"]), bodyJson: z.string(), sha256: z.string() }),
  ),
});

test("keeps exact text request and response in the ignored trial trace", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "s1-text-wire-"));
  const request = '{"model":"qwen-latest","messages":[{"role":"user","content":"Synthetic memo"}]}';
  const response = '{"choices":[{"message":{"content":"Synthetic memo"},"finish_reason":"stop"}]}';
  const outcome: TrialOutcome = {
    record: {
      modelId: "kev-4b",
      caseId: "fill-unsaved-draft",
      trial: 1,
      outcome: "success",
      gradedOutcome: "success",
      taskStatus: "complete",
      driverErrors: [],
      guardedExternalAttempts: 0,
      taskMs: 1,
      turns: 1,
      decisionRequests: 0,
      completedDecisionRequestMs: [],
      textRequests: 1,
      completedTextRequestMs: [1],
      writeDelta: zeroWrites,
      startedAt: "2026-09-27T00:00:00.000Z",
      endedAt: "2026-09-27T00:00:00.001Z",
    },
    stopMatrix: false,
    trace: [],
    decisionEvents: [],
    wireRequests: [],
    textWire: [
      { kind: "request", bodyJson: request, sha256: "request-sha" },
      { kind: "response", bodyJson: response, sha256: "response-sha" },
    ],
  };
  try {
    await recordEvidence(directory, outcome);
    const saved = savedTraceSchema.parse(
      await Bun.file(
        path.join(directory, "traces", "kev-4b", "fill-unsaved-draft-trial-1.json"),
      ).json(),
    );
    expect(saved.textWire).toHaveLength(EXPECTED_TEXT_EVENTS);
    expect(saved.textWire[0]).toEqual(outcome.textWire[0]);
    expect(saved.textWire[1]).toEqual(outcome.textWire[1]);
  } finally {
    await rm(directory, { recursive: true });
  }
});
