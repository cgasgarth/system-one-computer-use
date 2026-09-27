import { expect, test } from "bun:test";
import type { ActionChoices } from "../src/agent/contracts.ts";
import { decisionState } from "../src/models/decision-context.ts";
import { SystemOneDecisionModel } from "../src/models/system-one.ts";
import { decisionRequestSchema } from "../src/models/system-one-schema.ts";
import { desktopFixture, windowFixture } from "./fixtures.ts";

const LONG_TASK_SECTION = 900;
const finish = { kind: "finish", summary: "Done", reason: "Finish the request" } as const;
const blocked = { kind: "blocked", reason: "Stop for user input" } as const;
function response(choice: string, criteria: Readonly<Record<string, string>>): Response {
  return Response.json({
    answers: {
      next_action: {
        choice,
        probabilities: Object.fromEntries(
          Object.keys(criteria).map((key) => [key, Number(key === choice)]),
        ),
      },
    },
  });
}
function chooseCriterion(criteria: Readonly<Record<string, string>>, text: string): string {
  return (
    Object.entries(criteria).find(([, description]) => description.includes(text))?.[0] ?? "A0"
  );
}

test.each([
  {
    name: "requested link",
    task: "Open the requested project details",
    action: {
      kind: "click_element",
      pid: 7,
      window_id: 9,
      element_token: "target",
      reason: "Open requested details",
    } as const,
    element: {
      element_index: 1,
      element_token: "target",
      role: "link",
      label: "Requested project details",
      actions: ["AXPress"],
    },
    expected: "click_element",
  },
  {
    name: "empty draft field",
    task: "Enter Draft Only in Project name and leave it unsaved",
    action: {
      kind: "compose_text",
      pid: 7,
      window_id: 9,
      element_token: "target",
      reason: "Enter Project name",
    } as const,
    element: {
      element_index: 1,
      element_token: "target",
      role: "textbox",
      label: "Project name",
      value: "",
      editable: true,
    },
    expected: "compose_text",
  },
])("chooses the next observed action: $name", async ({ task, action, element, expected }) => {
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = decisionRequestSchema.parse(await request.json());
      const { criteria, instructions } = body.questions.next_action;
      return response(
        chooseCriterion(
          criteria,
          instructions.startsWith("Which operation") ? "visible control" : element.label,
        ),
        criteria,
      );
    },
  });
  try {
    const window = { ...windowFixture(), window_title: "Project list", elements: [element] };
    const actions: ActionChoices = [action, finish, blocked];
    const result = await new SystemOneDecisionModel(server.url.href, "model").choose({
      task,
      observation: { desktop: desktopFixture(), window },
      actions,
    });
    expect(result.action.kind).toBe(expected);
  } finally {
    await server.stop(true);
  }
});

test.each([
  {
    name: "saved document",
    task: "Save the edited document",
    value: "Changes saved",
  },
  {
    name: "unsubmitted draft",
    task: "Show the editor with Existing draft and leave it unsaved",
    value: "Existing draft",
  },
])("honors a primary Finish choice for an observed $name", async ({ task, value }) => {
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = decisionRequestSchema.parse(await request.json());
      expect(body.state).toContain(value);
      return response("A0", body.questions.next_action.criteria);
    },
  });
  try {
    const result = await new SystemOneDecisionModel(server.url.href, "model").choose({
      task,
      mode: "desktop",
      observation: {
        desktop: desktopFixture(),
        window: {
          ...windowFixture(),
          window_title: "Document editor",
          elements: [{ element_index: 1, element_token: "result", role: "heading", label: value }],
        },
      },
      actions: [finish, blocked],
    });
    expect(result.action.kind).toBe("finish");
  } finally {
    await server.stop(true);
  }
});

test("a sole Blocked action still requires a primary model choice", async () => {
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = decisionRequestSchema.parse(await request.json());
      expect(Object.keys(body.questions.next_action.criteria)).toEqual(["A0", "A1"]);
      return response("A0", body.questions.next_action.criteria);
    },
  });
  try {
    const result = await new SystemOneDecisionModel(server.url.href, "unused").choose({
      task: "Open a missing item",
      observation: { desktop: desktopFixture() },
      actions: [blocked],
    });
    expect(result.action.kind).toBe("blocked");
  } finally {
    await server.stop(true);
  }
});

test("the action decision keeps a middle constraint in the full current request", () => {
  const task = `${"First instruction ".repeat(LONG_TASK_SECTION)}Do not save or submit this draft. ${"Last instruction ".repeat(LONG_TASK_SECTION)}`;
  const state = decisionState({
    task,
    observation: { desktop: desktopFixture(), window: windowFixture() },
    actions: [finish],
  });
  expect(state).toContain(task);
});
test("tool-set descriptions name only surfaces offered in this decision", () => {
  const browser = {
    kind: "select_surface",
    surface: "browser",
    reason: "Use browser tools",
  } as const;
  const initial = decisionState({
    task: "Inspect a page",
    observation: { desktop: desktopFixture() },
    actions: [browser, finish],
  });
  expect(initial).toContain("Available tool sets: browser.");
  expect(initial).not.toContain("Both Chrome and Mac");
  const selected = decisionState({
    task: "Inspect a page",
    mode: "browser",
    observation: { desktop: desktopFixture(), window: windowFixture() },
    actions: [finish],
  });
  expect(selected).toContain("No other tool set is offered now.");
});
