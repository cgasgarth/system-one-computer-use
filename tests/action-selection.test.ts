import { expect, test } from "bun:test";
import type { ActionChoices } from "../src/agent/contracts.ts";
import { SystemOneDecisionModel } from "../src/models/system-one.ts";
import { decisionRequestSchema } from "../src/models/system-one-schema.ts";
import { desktopFixture } from "./fixtures.ts";

test("keeps the primary model's observed window target without a correlated self-veto", async () => {
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      decisionRequestSchema.parse(await request.json());
      return Response.json({
        answers: { next_action: { choice: "A0", probabilities: { A0: 0.7, A1: 0.2, A2: 0.1 } } },
      });
    },
  });
  const actions: ActionChoices = [
    { kind: "observe_window", pid: 7, window_id: 9, reason: "Inspect Messages" },
    { kind: "request_app", name: "Calculator", reason: "Open an installed app" },
    { kind: "blocked", reason: "User help is needed" },
  ];
  try {
    const result = await new SystemOneDecisionModel(server.url.href, "model").choose({
      task: "Open Calculator",
      mode: "desktop",
      observation: { desktop: desktopFixture() },
      actions,
    });
    expect(result.action.kind).toBe("observe_window");
  } finally {
    await server.stop(true);
  }
});

test("keeps the primary Blocked choice without a second model veto", async () => {
  let requests = 0;
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      decisionRequestSchema.parse(await request.json());
      requests += 1;
      return Response.json({
        answers: {
          next_action: { choice: "A1", probabilities: { A0: 0.1, A1: 0.9 } },
        },
      });
    },
  });
  try {
    const result = await new SystemOneDecisionModel(server.url.href, "model").choose({
      task: "Open Calculator",
      context: "Tool error: screen is locked; the user must unlock it.",
      observation: { desktop: desktopFixture() },
      actions: [
        { kind: "request_app", name: "Calculator", reason: "Open an installed app" },
        { kind: "blocked", reason: "User help is needed" },
      ],
    });
    expect(result.action.kind).toBe("blocked");
    expect(requests).toBe(1);
  } finally {
    await server.stop(true);
  }
});
