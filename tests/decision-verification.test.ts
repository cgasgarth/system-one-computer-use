import { expect, test } from "bun:test";
import type { ActionChoices } from "../src/agent/contracts.ts";
import { ActionSelectionError } from "../src/models/action-selection-error.ts";
import { SystemOneHttpDecisionModel } from "../src/models/system-one.ts";
import { decisionRequestSchema } from "../src/models/system-one-schema.ts";
import { desktopFixture, windowFixture } from "./fixtures.ts";

const nameField = {
  element_index: 1,
  element_token: "s1:1",
  role: "AXTextField",
  label: "Name",
  value: "",
  actions: ["AXPress", "AXSetValue"],
} as const;

function rankedAnswer(choice: string, keys: readonly string[]): Response {
  return Response.json({
    answers: {
      next_action: {
        choice,
        probabilities: Object.fromEntries(keys.map((key) => [key, Number(key === choice)])),
      },
    },
  });
}

async function expectRejectedSelection(choice: Promise<unknown>): Promise<void> {
  try {
    await choice;
  } catch (error) {
    expect(error).toBeInstanceOf(ActionSelectionError);
    if (!(error instanceof ActionSelectionError)) {
      throw new Error("Expected an action selection error", { cause: error });
    }
    expect(error.checks.map((check) => check.action.reason)).toEqual([
      "Type in Name",
      "Open panel",
    ]);
    expect(error.rejectedOperations).toHaveLength(1);
    const expectedGroups = 2;
    expect(error.groupCount).toBe(expectedGroups);
    expect(error.message).toContain("2 checks across 2 groups");
    expect(error.toJSON().checks).toHaveLength(expectedGroups);
    expect(JSON.stringify(error)).toContain('"kind":"action_selection"');
    return;
  }
  throw new Error("Expected an action selection error");
}

test.each([false, true])(
  "preserves checks from rejected operation groups (exhausted: %p)",
  async (exhausted) => {
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const body = decisionRequestSchema.parse(await request.json());
        const { instructions, criteria } = body.questions.next_action;
        const keys = Object.keys(criteria);
        if (instructions.startsWith("Has this user request")) {
          return rankedAnswer("A1", keys);
        }
        if (instructions.startsWith("Does entering text")) {
          return rankedAnswer("A1", keys);
        }
        if (instructions.startsWith("Is this exact control or menu")) {
          return rankedAnswer(exhausted ? "A1" : "A0", keys);
        }
        if (instructions.startsWith("Would this exact")) {
          return rankedAnswer("A1", keys);
        }
        return rankedAnswer("A0", keys);
      },
    });
    try {
      const choice = new SystemOneHttpDecisionModel(server.url.href, "model").choose({
        task: "Open a window",
        mode: "desktop",
        observation: {
          desktop: desktopFixture(),
          window: {
            ...windowFixture(),
            elements: [
              nameField,
              {
                element_index: 2,
                element_token: "button",
                role: "AXButton",
                label: "Open panel",
                actions: ["AXPress"],
              },
            ],
          },
        },
        actions: [
          {
            kind: "compose_text",
            pid: 7,
            window_id: 9,
            element_token: "s1:1",
            reason: "Type in Name",
          },
          {
            kind: "click_element",
            pid: 7,
            window_id: 9,
            element_token: "button",
            reason: "Open panel",
          },
        ],
      });
      if (exhausted) {
        await expectRejectedSelection(choice);
      } else {
        const result = await choice;
        expect(result.action.reason).toBe("Open panel");
        expect(result.checks?.map((check) => check.action.reason)).toEqual([
          "Type in Name",
          "Open panel",
          "Open panel",
        ]);
        expect(result.rejectedOperations).toHaveLength(1);
      }
    } finally {
      await server.stop(true);
    }
  },
);

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
    expect(result.action.kind).toBe("observe_window");
    expect(result.checks).toEqual([]);
  } finally {
    await server.stop(true);
  }
});

test("keeps a blocked stop when the model confirms required user help", async () => {
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = decisionRequestSchema.parse(await request.json());
      const check = body.questions.next_action.instructions.startsWith("Is there an enabled");
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

test("rejects an uncertain click match and chooses the clearly matching operation", async () => {
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = decisionRequestSchema.parse(await request.json());
      if (body.questions.next_action.instructions.startsWith("Has this user request")) {
        return Response.json({
          answers: { next_action: { choice: "A1", probabilities: { A0: 0, A1: 1 } } },
        });
      }
      if (body.questions.next_action.instructions.startsWith("Would this exact")) {
        return Response.json({
          answers: { next_action: { choice: "A1", probabilities: { A0: 0, A1: 1 } } },
        });
      }
      const uncertain = 0.6;
      const clear = 0.9;
      const matches =
        body.questions.next_action.instructions.startsWith("Is this exact control or menu") &&
        body.state.includes("Create event");
      const probability = matches ? clear : uncertain;
      return Response.json({
        answers: {
          next_action: { choice: "A0", probabilities: { A0: probability, A1: 1 - probability } },
        },
      });
    },
  });
  try {
    const result = await new SystemOneHttpDecisionModel(server.url.href, "model").choose({
      task: "Schedule an event",
      observation: {
        desktop: desktopFixture(),
        window: {
          ...windowFixture(),
          elements: [
            {
              element_index: 1,
              element_token: "reminder",
              role: "AXButton",
              label: "Create reminder",
              actions: ["AXPress"],
            },
            {
              element_index: 2,
              element_token: "event",
              role: "AXButton",
              label: "Create event",
              actions: ["AXPress"],
            },
          ],
        },
      },
      actions: [
        {
          kind: "click_element",
          pid: 7,
          window_id: 9,
          element_token: "reminder",
          reason: "Create reminder",
        },
        {
          kind: "click_element",
          pid: 7,
          window_id: 9,
          element_token: "event",
          reason: "Create event",
        },
      ],
    });
    expect(result.action.reason).toBe("Create event");
    const checked = 3;
    expect(result.checks).toHaveLength(checked);
    expect(result.checks?.at(-1)?.phase).toBe("commit-classification");
  } finally {
    await server.stop(true);
  }
});
