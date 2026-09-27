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

test("an observed navigation link can advance a task without a second relevance veto", async () => {
  const questions: string[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = decisionRequestSchema.parse(await request.json());
      const { instructions, criteria } = body.questions.next_action;
      questions.push(instructions);
      return answer(instructions.startsWith("Would this exact") ? "A1" : "A0", criteria);
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
    expect(questions.some((question) => question.startsWith("Is this exact control"))).toBe(false);
    expect(result.checks?.map((check) => check.phase)).toEqual(["commit-classification"]);
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
])(
  "observed native $operation uses the primary choice and keeps the effect gate",
  async (caseInput) => {
    const questions: string[] = [];
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const body = decisionRequestSchema.parse(await request.json());
        const { instructions, criteria } = body.questions.next_action;
        questions.push(instructions);
        return answer(instructions.startsWith("Would this exact") ? "A1" : "A0", criteria);
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
      expect(questions.some((question) => question.startsWith("Is this exact control"))).toBe(
        false,
      );
      expect(result.checks?.map((check) => check.phase)).toEqual(["commit-classification"]);
    } finally {
      await server.stop(true);
    }
  },
);

test("a model-selected form submit still fails the separate commit gate", async () => {
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = decisionRequestSchema.parse(await request.json());
      const { instructions, criteria } = body.questions.next_action;
      const denied = instructions.startsWith("Should the assistant activate");
      return answer(denied ? "A1" : "A0", criteria);
    },
  });
  try {
    const save = {
      kind: "click_element",
      pid: 7,
      window_id: 9,
      element_token: "save",
      reason: "Save draft",
    } as const;
    const result = await new SystemOneDecisionModel(server.url.href, "test").choose({
      task: "Leave the draft open without saving",
      observation: {
        desktop: desktopFixture(),
        window: {
          ...windowFixture(),
          elements: [
            {
              element_index: 1,
              element_token: "save",
              role: "button",
              label: "Save draft",
              actions: ["AXPress"],
            },
          ],
        },
      },
      mode: "browser",
      actions: [save, { kind: "blocked", reason: "Stop" }],
      async inspectClick() {
        return { kind: "form_submit" };
      },
    });
    expect(result.action.kind).toBe("blocked");
    expect(result.checks?.map((check) => check.phase)).toContain("form-semantics");
    expect(result.checks?.map((check) => check.phase)).toContain("commit-authorization");
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
    expect(questions.some((question) => question.startsWith("Does entering text"))).toBe(false);
  } finally {
    await server.stop(true);
  }
});
