import { expect, test } from "bun:test";
import type { ActionChoices } from "../src/agent/contracts.ts";
import { SystemOneHttpDecisionModel } from "../src/models/system-one.ts";
import { decisionRequestSchema } from "../src/models/system-one-schema.ts";
import { desktopFixture } from "./fixtures.ts";

test("rejects an unrelated window and selects the next ranked tool", async () => {
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = decisionRequestSchema.parse(await request.json());
      if (body.questions.next_action.instructions.startsWith("Does the proposed")) {
        return Response.json({
          answers: { next_action: { choice: "A1", probabilities: { A0: 0.1, A1: 0.9 } } },
        });
      }
      return Response.json({
        answers: { next_action: { choice: "A0", probabilities: { A0: 0.7, A1: 0.2, A2: 0.1 } } },
      });
    },
  });
  const actions: ActionChoices = [
    { kind: "observe_window", pid: 7, window_id: 9, reason: "Inspect Messages" },
    { kind: "request_app", reason: "Open an installed app" },
    { kind: "blocked", reason: "User help is needed" },
  ];
  try {
    const result = await new SystemOneHttpDecisionModel(server.url.href, "model").choose({
      task: "Open Calculator",
      mode: "desktop",
      observation: { desktop: desktopFixture() },
      actions,
    });
    expect(result.action.kind).toBe("request_app");
    expect(result.checks?.[0]?.answer.choice).toBe("A1");
  } finally {
    await server.stop(true);
  }
});

test("keeps a blocked stop when the model confirms required user help", async () => {
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = decisionRequestSchema.parse(await request.json());
      const check = body.questions.next_action.instructions.startsWith("Does a missing");
      return Response.json({
        answers: {
          next_action: check
            ? { choice: "A0", probabilities: { A0: 0.99, A1: 0.01 } }
            : { choice: "A1", probabilities: { A0: 0.1, A1: 0.9 } },
        },
      });
    },
  });
  try {
    const result = await new SystemOneHttpDecisionModel(server.url.href, "model").choose({
      task: "Open Calculator",
      context: "Tool error: screen is locked; the user must unlock it.",
      observation: { desktop: desktopFixture() },
      actions: [
        { kind: "request_app", reason: "Open an installed app" },
        { kind: "blocked", reason: "User help is needed" },
      ],
    });
    expect(result.action.kind).toBe("blocked");
    expect(result.checks?.[0]?.answer.choice).toBe("A0");
  } finally {
    await server.stop(true);
  }
});
