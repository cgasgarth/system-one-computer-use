import { expect, test } from "bun:test";
import type { ActionChoices } from "../src/agent/contracts.ts";
import { SystemOneHttpDecisionModel } from "../src/models/system-one.ts";
import { decisionRequestSchema } from "../src/models/system-one-schema.ts";
import { desktopFixture, expectFailure, windowFixture } from "./fixtures.ts";

const cases: { readonly probability: number; readonly expected: "finish" | "press_key" }[] = [
  { probability: 0.95, expected: "finish" },
  { probability: 0.51, expected: "press_key" },
];
function choices(): ActionChoices {
  const target = windowFixture();
  return [
    {
      kind: "press_key",
      key: "return",
      modifiers: [],
      pid: target.pid,
      window_id: target.window_id,
      reason: "Press return",
    },
    { kind: "finish", reason: "Task is complete", summary: "Done" },
    { kind: "blocked", reason: "Need help" },
  ];
}
test.each(cases)(
  "uses the model's completion check with probability $probability",
  async ({ probability, expected }) => {
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const body = decisionRequestSchema.parse(await request.json());
        const checking =
          body.questions.next_action.instructions === "Has the user request been completed?";
        expect(body.state).toContain("Open Messages");
        return Response.json({
          answers: {
            next_action: checking
              ? { choice: "A0", probabilities: { A0: probability, A1: 1 - probability } }
              : { choice: "A0", probabilities: { A0: 1, A1: 0 } },
          },
        });
      },
    });
    try {
      const result = await new SystemOneHttpDecisionModel(
        server.url.href,
        "any-system-one-model",
      ).choose({
        task: "Open Messages",
        observation: { desktop: desktopFixture(), window: windowFixture() },
        actions: choices(),
        mode: "desktop",
      });
      expect(result.action.kind).toBe(expected);
      expect(result.completion?.probabilities["A0"]).toBe(probability);
    } finally {
      await server.stop(true);
    }
  },
);
test("rejects an invalid completion probability distribution", async () => {
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = decisionRequestSchema.parse(await request.json());
      if (body.questions.next_action.instructions.startsWith("Does this request")) {
        return Response.json({
          answers: { next_action: { choice: "A1", probabilities: { A0: 0, A1: 1 } } },
        });
      }
      return Response.json({
        answers: { next_action: { choice: "A0", probabilities: { A0: 0.2, A1: 0 } } },
      });
    },
  });
  try {
    const promise = new SystemOneHttpDecisionModel(server.url.href, "model").choose({
      task: "Open Messages",
      observation: { desktop: desktopFixture(), window: windowFixture() },
      actions: choices(),
    });
    await expectFailure(promise, "invalid completion decision");
  } finally {
    await server.stop(true);
  }
});
