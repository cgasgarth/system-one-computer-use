import { expect, test } from "bun:test";
import type { ActionChoices } from "../src/agent/contracts.ts";
import { ActionSelectionError } from "../src/models/action-selection-error.ts";
import { SystemOneDecisionModel } from "../src/models/system-one.ts";
import { decisionRequestSchema } from "../src/models/system-one-schema.ts";
import { desktopFixture, windowFixture } from "./fixtures.ts";

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
    expect(result.checks?.[0]?.answer.choice).toBe("A0");
  } finally {
    await server.stop(true);
  }
});

async function expectRejectedSelectionWithAuthorization(choice: Promise<unknown>): Promise<void> {
  try {
    await choice;
  } catch (error) {
    expect(error).toBeInstanceOf(ActionSelectionError);
    if (error instanceof ActionSelectionError) {
      expect(error.checks.map((check) => check.phase)).toEqual([
        "form-semantics",
        "commit-authorization",
      ]);
    }
    return;
  }
  throw new Error("A forbidden persistent click was allowed");
}

test.each([false, true])(
  "accepts an observed control while keeping persistent authorization (%p)",
  async (persistent) => {
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const body = decisionRequestSchema.parse(await request.json());
        const question = body.questions.next_action.instructions;
        if (question.startsWith("Has this user request")) {
          return rankedAnswer("A1", ["A0", "A1"]);
        }
        if (
          question.startsWith("Would this exact") ||
          question.startsWith("Should the assistant activate")
        ) {
          return rankedAnswer("A1", ["A0", "A1"]);
        }
        throw new Error(`Unexpected question: ${question}`);
      },
    });
    try {
      const result = new SystemOneDecisionModel(server.url.href, "model").choose({
        task: persistent ? "Do not save this draft" : "Open the selected conversation",
        observation: {
          desktop: desktopFixture(),
          window: {
            ...windowFixture(),
            elements: [
              {
                element_index: 1,
                element_token: "target",
                role: "AXButton",
                label: persistent ? "Save draft" : "Conversation",
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
            element_token: "target",
            reason: persistent ? "Activate Save draft" : "Activate Conversation",
          },
        ],
        ...(persistent
          ? {
              inspectClick: async (): Promise<{ kind: "form_submit" }> => ({ kind: "form_submit" }),
            }
          : {}),
      });
      if (persistent) {
        await expectRejectedSelectionWithAuthorization(result);
      } else {
        const allowed = await result;
        expect(allowed.action.kind).toBe("click_element");
        expect(allowed.checks?.map((check) => check.phase)).toEqual(["commit-classification"]);
      }
    } finally {
      await server.stop(true);
    }
  },
);
