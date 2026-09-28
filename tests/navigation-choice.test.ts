import { expect, test } from "bun:test";
import { SystemOneDecisionModel } from "../src/models/system-one.ts";
import { decisionRequestSchema } from "../src/models/system-one-schema.ts";
import { desktopFixture, windowFixture } from "./fixtures.ts";

function answer(choice: string, criteria: Readonly<Record<string, string>>): Response {
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

test("selects the observed navigation link for the requested document", async () => {
  const questions: string[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = decisionRequestSchema.parse(await request.json());
      const { instructions, criteria } = body.questions.next_action;
      questions.push(instructions);
      return answer("A0", criteria);
    },
  });
  try {
    const link = {
      kind: "click_element",
      pid: 7,
      window_id: 9,
      element_token: "target",
      reason: "Open requested document",
    } as const;
    const result = await new SystemOneDecisionModel(server.url.href, "test").choose({
      task: "Open the requested document",
      observation: {
        desktop: desktopFixture(),
        window: {
          ...windowFixture(),
          elements: [
            {
              element_index: 1,
              element_token: "target",
              role: "link",
              label: "Requested document",
              href: "https://example.test/item",
              actions: ["AXPress"],
            },
          ],
        },
      },
      mode: "browser",
      actions: [link, { kind: "blocked", reason: "Stop" }],
    });
    expect(result.action).toEqual(link);
    expect(questions).toHaveLength(1);
  } finally {
    await server.stop(true);
  }
});

test.each([
  {
    operation: "open" as const,
    role: "AXCell",
    subrole: undefined,
    capability: "AXOpen",
    reason: "Open selected item",
  },
  {
    operation: "confirm" as const,
    role: "AXTextField",
    subrole: "AXSearchField",
    capability: "AXConfirm",
    reason: "Submit search",
  },
])("selects the observed native $operation action", async (caseInput) => {
  const questions: string[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = decisionRequestSchema.parse(await request.json());
      const { instructions, criteria } = body.questions.next_action;
      questions.push(instructions);
      return answer("A0", criteria);
    },
  });
  try {
    const action = {
      kind: "click_element",
      pid: 7,
      window_id: 9,
      element_token: "native",
      operation: caseInput.operation,
      reason: caseInput.reason,
    } as const;
    const window = {
      ...windowFixture(),
      elements: [
        {
          element_index: 1,
          element_token: "native",
          role: caseInput.role,
          ...(caseInput.subrole === undefined ? {} : { subrole: caseInput.subrole }),
          label: "Observed target",
          actions: [caseInput.capability],
        },
      ],
    };
    const result = await new SystemOneDecisionModel(server.url.href, "test").choose({
      task: "Use the selected native control",
      observation: { desktop: desktopFixture(), window },
      mode: "desktop",
      actions: [action, { kind: "blocked", reason: "Stop" }],
    });
    expect(result.action).toEqual(action);
    expect(questions).toHaveLength(1);
  } finally {
    await server.stop(true);
  }
});

test("an observed search field uses the primary grounded text choice", async () => {
  const questions: string[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = decisionRequestSchema.parse(await request.json());
      const { instructions, criteria } = body.questions.next_action;
      questions.push(instructions);
      return answer("A0", criteria);
    },
  });
  try {
    const search = {
      kind: "compose_text",
      pid: 7,
      window_id: 9,
      element_token: "search",
      reason: "Type into search field",
    } as const;
    const result = await new SystemOneDecisionModel(server.url.href, "test").choose({
      task: "Find a document in this window",
      observation: {
        desktop: desktopFixture(),
        window: {
          ...windowFixture(),
          elements: [
            {
              element_index: 1,
              element_token: "search",
              role: "AXTextField",
              subrole: "AXSearchField",
              label: "Search",
              editable: true,
            },
          ],
        },
      },
      mode: "desktop",
      actions: [search, { kind: "blocked", reason: "Stop" }],
    });
    expect(result.action).toEqual(search);
    expect(questions).toHaveLength(1);
  } finally {
    await server.stop(true);
  }
});
