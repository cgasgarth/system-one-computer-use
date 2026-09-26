import { expect, test } from "bun:test";
import type { ActionChoices } from "../src/agent/contracts.ts";
import { ActionSelectionError } from "../src/models/action-selection-error.ts";
import { SystemOneHttpDecisionModel } from "../src/models/system-one.ts";
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

async function expectRejectedSelection(choice: Promise<unknown>): Promise<void> {
  try {
    await choice;
  } catch (error) {
    expect(error).toBeInstanceOf(ActionSelectionError);
    if (!(error instanceof ActionSelectionError)) {
      throw new Error("Expected an action selection error", { cause: error });
    }
    expect(error.checks.map((check) => check.action.reason)).toEqual([
      "Type in Search",
      "Inspect Messages",
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
        if (instructions.startsWith("Does the proposed action")) {
          return rankedAnswer(exhausted ? "A1" : "A0", keys);
        }
        return rankedAnswer("A0", keys);
      },
    });
    try {
      const choice = new SystemOneHttpDecisionModel(server.url.href, "model").choose({
        task: "Open a window",
        mode: "desktop",
        observation: { desktop: desktopFixture(), window: windowFixture() },
        actions: [
          {
            kind: "compose_text",
            pid: 7,
            window_id: 9,
            element_token: "s1:1",
            reason: "Type in Search",
          },
          { kind: "observe_window", pid: 7, window_id: 9, reason: "Inspect Messages" },
        ],
      });
      if (exhausted) {
        await expectRejectedSelection(choice);
      } else {
        const result = await choice;
        expect(result.action.reason).toBe("Inspect Messages");
        expect(result.checks?.map((check) => check.action.reason)).toEqual([
          "Type in Search",
          "Inspect Messages",
        ]);
        expect(result.rejectedOperations).toHaveLength(1);
      }
    } finally {
      await server.stop(true);
    }
  },
);

test("rejects an unrelated window and selects the next ranked tool", async () => {
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = decisionRequestSchema.parse(await request.json());
      if (body.questions.next_action.instructions.startsWith("Does the proposed")) {
        return Response.json({
          answers: { next_action: { choice: "A1", probabilities: { A0: 0.1, A1: 0.9 } } },
        });
      }
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
    expect(result.action.kind).toBe("request_app");
    expect(result.checks?.[0]?.answer.choice).toBe("A1");
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
      const uncertain = 0.6;
      const clear = 0.9;
      const matches =
        body.questions.next_action.instructions.startsWith("Is this exact click") &&
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
      observation: { desktop: desktopFixture() },
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
    const checked = 2;
    expect(result.checks).toHaveLength(checked);
  } finally {
    await server.stop(true);
  }
});
