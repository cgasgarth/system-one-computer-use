import { expect, test } from "bun:test";
import { SystemOneHttpDecisionModel } from "../src/models/system-one.ts";
import { decisionRequestSchema } from "../src/models/system-one-schema.ts";
import { desktopFixture, windowFixture } from "./fixtures.ts";

const TARGET_YES = 0.57;
const PRIMARY_CONFIDENCE = 0.95;

test("completion target sees the selected app separately from its dialog title", async () => {
  let targetState = "";
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = decisionRequestSchema.parse(await request.json());
      const question = body.questions.next_action.instructions;
      if (question.startsWith("Does the selected app")) {
        targetState = body.state;
      }
      const yesProbability = question.startsWith("Does the selected app")
        ? TARGET_YES
        : PRIMARY_CONFIDENCE;
      return Response.json({
        answers: {
          next_action: {
            choice: "A0",
            probabilities: { A0: yesProbability, A1: 1 - yesProbability },
          },
        },
      });
    },
  });
  try {
    const current = { ...windowFixture(), app_name: "Player", window_title: "Open" };
    const result = await new SystemOneHttpDecisionModel(server.url.href, "test-model").choose({
      task: "Open the player application",
      context: "Previous request (historical context only): Open another document",
      mode: "desktop",
      observation: {
        desktop: desktopFixture(),
        application: { name: "Player", pid: current.pid },
        window: current,
      },
      actions: [
        { kind: "finish", summary: "Done", reason: "Finish" },
        { kind: "blocked", reason: "Stop" },
      ],
    });
    expect(result.action.kind).toBe("finish");
    expect(result.completionTarget?.probabilities["A0"]).toBe(TARGET_YES);
    expect(targetState).toContain("Selected application: Player");
    expect(targetState).toContain("Current window: Player: Open");
    expect(targetState).toContain("Previous session context (references only)");
  } finally {
    await server.stop(true);
  }
});

test("a selected target No still prevents Finish", async () => {
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = decisionRequestSchema.parse(await request.json());
      const instruction = body.questions.next_action.instructions;
      const target = instruction.startsWith("Does the selected app");
      const criteria = Object.keys(body.questions.next_action.criteria);
      return Response.json({
        answers: {
          next_action: target
            ? { choice: "A1", probabilities: { A0: 1 - TARGET_YES, A1: TARGET_YES } }
            : {
                choice: "A0",
                probabilities: Object.fromEntries(
                  criteria.map((key) => [key, Number(key === "A0")]),
                ),
              },
        },
      });
    },
  });
  try {
    const result = await new SystemOneHttpDecisionModel(server.url.href, "test").choose({
      task: "Open the requested item",
      context: "Previous request was about another item",
      observation: { desktop: desktopFixture(), window: windowFixture() },
      actions: [
        { kind: "finish", summary: "Done", reason: "Finish" },
        { kind: "blocked", reason: "Stop" },
      ],
    });
    expect(result.action.kind).toBe("blocked");
    expect(result.completionTarget?.choice).toBe("A1");
  } finally {
    await server.stop(true);
  }
});
