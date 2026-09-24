import { expect, test } from "bun:test";
import { describeAction } from "../src/agent/contracts.ts";
import type { Action, ActionChoices } from "../src/agent/contracts.ts";
import { SystemOneHttpDecisionModel } from "../src/models/system-one.ts";
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
          answers: { next_action: { choice: "A1", probabilities: { A0: 0, A1: 1 } } },
        });
      },
      port: 0,
    });
    try {
      const model = new SystemOneHttpDecisionModel(
        new URL("/v1/systemone", server.url).href,
        modelId,
        "test-token",
      );
      const actions: ActionChoices = [
        { kind: "launch_app", name: "Settings", reason: "Open it" },
        { kind: "finish", reason: "Already complete", summary: "Done" },
      ];
      const result = await model.choose(
        "Open Settings",
        { desktop: { apps: [], windows: [] } },
        actions,
      );
      const request = await captured.promise;
      expect(request.model).toBe(modelId);
      expect(Object.keys(request.questions.next_action.criteria)).toEqual(["A0", "A1"]);
      expect(result.action).toEqual({
        kind: "finish",
        reason: "Already complete",
        summary: "Done",
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
    const model = new SystemOneHttpDecisionModel(server.url.href, "any-model");
    await expectFailure(
      model.choose("Open Settings", { desktop: { apps: [], windows: [] } }, [
        { kind: "launch_app", name: "Settings", reason: "Open it" },
      ]),
      "Too small",
    );
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
