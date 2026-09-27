import { expect, test } from "bun:test";
import { SystemOneDecisionModel } from "../src/models/system-one.ts";
import { decisionRequestSchema } from "../src/models/system-one-schema.ts";
import { desktopFixture, windowFixture } from "./fixtures.ts";
import type { ActionChoices } from "../src/agent/contracts.ts";
import { actionGroups } from "../src/models/decision-context.ts";

const actions: ActionChoices = [
  { kind: "compose_text", pid: 7, window_id: 9, element_token: "field", reason: "Enter message" },
  { kind: "compose_text", pid: 7, window_id: 9, element_token: "subject", reason: "Enter subject" },
  { kind: "click_element", pid: 7, window_id: 9, element_token: "save", reason: "Save document" },
  {
    kind: "click_element",
    operation: "pick",
    pid: 7,
    window_id: 9,
    element_token: "option",
    reason: "Pick High",
  },
  {
    kind: "click_element",
    operation: "open",
    pid: 7,
    window_id: 9,
    element_token: "file",
    reason: "Open file",
  },
  {
    kind: "click_element",
    operation: "confirm",
    pid: 7,
    window_id: 9,
    element_token: "confirm",
    reason: "Confirm input",
  },
  {
    kind: "press_key",
    pid: 7,
    window_id: 9,
    element_token: "field",
    key: "tab",
    modifiers: [],
    reason: "Press tab",
  },
  {
    kind: "invoke_menu",
    pid: 7,
    window_id: 9,
    path: ["File", "Open"],
    reason: "Choose menu File > Open",
  },
  { kind: "finish", reason: "Complete", summary: "Done" },
  { kind: "blocked", reason: "Blocked" },
];
test("groups text, click, and keyboard actions by their observed operation kind", () => {
  const groups = actionGroups(actions);
  expect(groups.map((group) => group.kind)).toEqual([
    "compose_text",
    "click_press",
    "click_pick",
    "click_open",
    "click_confirm",
    "press_key",
    "invoke_menu",
    "finish",
    "blocked",
  ]);
  expect(groups.find((group) => group.kind === "compose_text")?.description).toBe(
    "Enter or replace text in an editable field.",
  );
  expect(groups.find((group) => group.kind === "click_press")?.description).toBe(
    "Click a button or open an existing link.",
  );
  expect(groups.find((group) => group.kind === "click_pick")?.description).toBe(
    "Pick an observed option or item.",
  );
  expect(groups.find((group) => group.kind === "click_open")?.description).toBe(
    "Open an observed item.",
  );
  expect(groups.find((group) => group.kind === "click_confirm")?.description).toBe(
    "Confirm an observed control.",
  );
  expect(groups.find((group) => group.kind === "invoke_menu")?.description).toBe(
    "Use an observed command in this application's menu.",
  );
  expect(groups.flatMap((group) => group.actions).map((action) => action.reason)).toEqual(
    actions.map((action) => action.reason),
  );
});
test("selects an operation before a compatible target and records both distributions", async () => {
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = decisionRequestSchema.parse(await request.json());
      const question = body.questions.next_action.instructions;
      if (question.startsWith("Which operation")) {
        expect(
          Object.values(body.questions.next_action.criteria).some((item) =>
            item.startsWith("Enter or replace text in an editable field"),
          ),
        ).toBe(true);
        return Response.json({
          answers: {
            next_action: {
              choice: "A0",
              probabilities: Object.fromEntries(
                Object.keys(body.questions.next_action.criteria).map((key) => [
                  key,
                  Number(key === "A0"),
                ]),
              ),
            },
          },
        });
      }
      if (question.startsWith("Does entering")) {
        return Response.json({
          answers: { next_action: { choice: "A0", probabilities: { A0: 1, A1: 0 } } },
        });
      }
      expect(Object.values(body.questions.next_action.criteria)).toEqual([
        "Enter message",
        "Enter subject",
        "None of these targets; choose another operation without taking an action.",
      ]);
      return Response.json({
        answers: { next_action: { choice: "A0", probabilities: { A0: 1, A1: 0, A2: 0 } } },
      });
    },
  });
  try {
    const result = await new SystemOneDecisionModel(server.url.href, "test").choose({
      task: "Write hello",
      mode: "desktop",
      actions,
      observation: { desktop: desktopFixture(), window: windowFixture() },
    });
    expect(result.action.kind).toBe("compose_text");
    expect(result.operation?.answer.choice).toBe("A0");
    expect(result.candidates).toEqual(actions.filter((action) => action.kind === "compose_text"));
  } finally {
    await server.stop(true);
  }
});
