import { expect, test } from "bun:test";
import { targetCorrectionActions } from "../src/models/action-space.ts";
import { SystemOneHttpDecisionModel } from "../src/models/system-one.ts";
import { decisionRequestSchema } from "../src/models/system-one-schema.ts";
import { desktopFixture, windowFixture } from "./fixtures.ts";
import type { ActionChoices } from "../src/agent/contracts.ts";

const actions: ActionChoices = [
  { kind: "compose_text", pid: 7, window_id: 9, element_token: "field", reason: "Enter message" },
  { kind: "click_element", pid: 7, window_id: 9, element_token: "save", reason: "Save document" },
  { kind: "finish", reason: "Complete", summary: "Done" },
  { kind: "blocked", reason: "Blocked" },
];
test("selects an operation before a compatible target and records both distributions", async () => {
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = decisionRequestSchema.parse(await request.json());
      const question = body.questions.next_action.instructions;
      const answer = { choice: "A0", probabilities: { A0: 1 } };
      if (question.startsWith("Has this")) {
        return Response.json({
          answers: { next_action: { choice: "A1", probabilities: { A0: 0, A1: 1 } } },
        });
      }
      if (question.startsWith("Which operation")) {
        expect(Object.values(body.questions.next_action.criteria)).toContain(
          "Enter or replace text in an editable field.",
        );
        return Response.json({
          answers: { next_action: { choice: "A0", probabilities: { A0: 1, A1: 0, A2: 0 } } },
        });
      }
      if (question.startsWith("Does entering")) {
        return Response.json({
          answers: { next_action: { choice: "A0", probabilities: { A0: 1, A1: 0 } } },
        });
      }
      expect(Object.values(body.questions.next_action.criteria)).toEqual(["Enter message"]);
      return Response.json({ answers: { next_action: answer } });
    },
  });
  try {
    const result = await new SystemOneHttpDecisionModel(server.url.href, "test").choose({
      task: "Write hello",
      mode: "desktop",
      actions,
      observation: { desktop: desktopFixture(), window: windowFixture() },
    });
    expect(result.action.kind).toBe("compose_text");
    expect(result.operation?.answer.choice).toBe("A0");
    expect(result.candidates).toEqual([actions[0]]);
  } finally {
    await server.stop(true);
  }
});

test("target correction offers navigation controls without unrelated action buttons", () => {
  const names = ["Autumn plan", "Autumn plan", "Autumn plan", "Save document"];
  const roles = ["button", "tab", "row", "button"];
  const targets = names.map((name, index) => ({
    kind: "click_element" as const,
    pid: 7,
    window_id: 9,
    element_token: `e${index}`,
    reason: `Activate ${name}`,
  }));
  const window = {
    ...windowFixture(),
    elements: names.map((name, index) => ({
      element_index: index,
      element_token: `e${index}`,
      role: roles[index] ?? "button",
      label: name,
      actions: ["AXPress"],
    })),
  };
  const corrected = targetCorrectionActions({
    actions: targets,
    observation: { desktop: desktopFixture(), window },
  });
  expect(
    corrected.map((action) => (action.kind === "click_element" ? action.element_token : "")),
  ).toEqual(["e1", "e2"]);
});
