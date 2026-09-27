import { expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { z } from "zod";
import { TaskTrace } from "../src/app/task-trace.ts";

const savedSchema = z.object({
  status: z.enum(["running", "stopped", "error"]),
  task: z.string(),
  model: z.object({ decision: z.object({ modelId: z.string(), endpointOrigin: z.string() }) }),
  stage: z.object({ name: z.string(), stepIndex: z.number(), elapsedMs: z.number() }),
  modelRequests: z.object({
    total: z.number(),
    decision: z.number(),
    active: z.object({ phase: z.string(), candidateCount: z.number(), elapsedMs: z.number() }),
    recent: z.array(
      z.object({
        phase: z.string(),
        status: z.string(),
        choice: z.string().optional(),
        selectedProbability: z.number().optional(),
      }),
    ),
  }),
  decisions: z.number(),
});

// This single interruption fixture checks the saved phase, count, choice, and timing together.
// eslint-disable-next-line eslint/max-statements
test("saves the active model phase before an interrupted decision finishes", async () => {
  const candidateCount = 4;
  const completedRequestMs = 5;
  const selectedProbability = 0.8;
  const requestCount = 2;
  const trace = new TaskTrace({
    decision: { modelId: "decision-qa", endpointOrigin: "http://127.0.0.1:8700" },
    text: { modelId: "text-qa", endpointOrigin: "http://127.0.0.1:8080" },
  });
  try {
    trace.begin("Open the fixture", "qa-session");
    trace.setStage({ stage: "decision", stepIndex: 1 });
    trace.modelRequest({ phase: "completion", status: "start", candidateCount });
    trace.modelRequest({
      phase: "completion",
      status: "ok",
      candidateCount,
      elapsedMs: completedRequestMs,
      choice: "A0",
      selectedProbability,
    });
    trace.modelRequest({ phase: "target", status: "start", candidateCount });
    const active = savedSchema.parse(await Bun.file(trace.checkpointPath).json());
    expect(active.status).toBe("running");
    expect(active.decisions).toBe(0);
    expect(active.stage.name).toBe("decision");
    expect(active.modelRequests.total).toBe(requestCount);
    expect(active.modelRequests.active.phase).toBe("target");
    expect(active.modelRequests.active.candidateCount).toBe(candidateCount);
    expect(
      active.modelRequests.recent.find(
        (event) => event.phase === "completion" && event.status === "ok",
      ),
    ).toMatchObject({ choice: "A0", selectedProbability });
    trace.saveFailure("stopped", "Stopped by user");
    const stopped = savedSchema.parse(await Bun.file(trace.failurePath).json());
    expect(stopped.status).toBe("stopped");
    expect(stopped.model.decision.modelId).toBe("decision-qa");
    expect(stopped.modelRequests.active.elapsedMs).toBeGreaterThanOrEqual(0);
  } finally {
    await trace.clearCheckpoint();
    await rm(trace.failurePath, { force: true });
  }
});
