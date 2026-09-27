import { expect, test } from "bun:test";
import { describeAction } from "../src/agent/contracts.ts";
import type { Action, ActionChoices } from "../src/agent/contracts.ts";
import { SystemOneDecisionModel } from "../src/models/system-one.ts";
import { decisionRequestSchema } from "../src/models/system-one-schema.ts";
import type { DecisionRequest } from "../src/models/system-one-schema.ts";
import { expectFailure } from "./fixtures.ts";

test.each(["clm-latest", "jev-latest", "another-system-one-model"])(
  "supports %s through the same contract",
  async (modelId) => {
    const captured = Promise.withResolvers<DecisionRequest>();
    const server = Bun.serve({
      async fetch(request) {
        expect(request.headers.get("authorization")).toBe("Bearer test-token");
        captured.resolve(decisionRequestSchema.parse(await request.json()));
        return Response.json({
          answers: {
            next_action: { choice: "A0", probabilities: { A0: 1, A1: 0 } },
          },
        });
      },
      port: 0,
    });
    try {
      const model = new SystemOneDecisionModel(new URL("/v1/systemone", server.url).href, modelId, {
        apiKey: "test-token",
      });
      const actions: ActionChoices = [
        { kind: "request_app", name: "Messages", reason: "Open an application" },
        { kind: "finish", reason: "Already complete", summary: "Done" },
      ];
      const result = await model.choose({
        task: "Open Settings",
        observation: { desktop: { apps: [], windows: [] } },
        actions,
      });
      const request = await captured.promise;
      expect(request.model).toBe(modelId);
      expect(request.questions.next_action.instructions).toContain("Open Settings");
      expect(Object.keys(request.questions.next_action.criteria)).toEqual(["A0", "A1"]);
      expect(result.action).toEqual({
        kind: "request_app",
        name: "Messages",
        reason: "Open an application",
      });
    } finally {
      await server.stop(true);
    }
  },
);

test("rejects an invalid external probability distribution", async () => {
  const server = Bun.serve({
    fetch() {
      return Response.json({
        answers: { next_action: { choice: "A0", probabilities: { A0: -1 } } },
      });
    },
    port: 0,
  });
  try {
    const model = new SystemOneDecisionModel(server.url.href, "any-model");
    await expectFailure(
      model.choose({
        task: "Open Settings",
        observation: { desktop: { apps: [], windows: [] } },
        actions: [
          { kind: "request_app", name: "Messages", reason: "Open an application" },
          { kind: "blocked", reason: "Need help" },
        ],
      }),
      "Too small",
    );
  } finally {
    await server.stop(true);
  }
});
test("observes the exact typed request before transport without changing a choice", async () => {
  const wire = Promise.withResolvers<DecisionRequest>();
  const sent = Promise.withResolvers<DecisionRequest>();
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      sent.resolve(decisionRequestSchema.parse(await request.json()));
      return Response.json({
        answers: { next_action: { choice: "A0", probabilities: { A0: 1, A1: 0 } } },
      });
    },
  });
  try {
    const result = await new SystemOneDecisionModel(server.url.href, "test").choose({
      task: "Open the requested app",
      observation: { desktop: { apps: [], windows: [] } },
      actions: [
        { kind: "request_app", name: "Notes", reason: "Open Notes" },
        { kind: "blocked", reason: "Blocked" },
      ],
      onWire(event) {
        expect(event.phase).toBe("target");
        wire.resolve(event.body);
        throw new Error("An observer cannot veto a decision.");
      },
    });
    expect(await wire.promise).toEqual(await sent.promise);
    expect(result.action.kind).toBe("request_app");
  } finally {
    await server.stop(true);
  }
});

test("keeps semantic action text stable when Cua handles change", () => {
  const action: Action = {
    element_token: "p1:1",
    kind: "click_element",
    pid: 7,
    reason: "Activate Save note",
    window_id: 9,
  };
  expect(describeAction(action)).toBe(
    describeAction({ ...action, element_token: "p2:14", pid: 20 }),
  );
});
