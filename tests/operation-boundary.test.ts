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

test("a rejected Blocked operation cannot execute another operation's application action", async () => {
  let operations = 0;
  let targets = 0;
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = decisionRequestSchema.parse(await request.json());
      const { instructions, criteria } = body.questions.next_action;
      if (instructions.startsWith("Has this user request")) {
        return answer("A1", criteria);
      }
      if (instructions.startsWith("Which operation")) {
        operations += 1;
        return answer("A0", criteria);
      }
      if (instructions.startsWith("Which action")) {
        targets += 1;
        return answer("A0", criteria);
      }
      if (instructions.startsWith("Is there an enabled")) {
        return answer("A1", criteria);
      }
      if (instructions.startsWith("Would this exact")) {
        return answer("A1", criteria);
      }
      return answer("A0", criteria);
    },
  });
  try {
    const window = {
      ...windowFixture(),
      elements: [
        {
          element_index: 1,
          element_token: "control",
          role: "AXButton",
          label: "Selected control",
          actions: ["AXPress"],
        },
      ],
    };
    const selected = await new SystemOneDecisionModel(server.url.href, "test").choose({
      task: "Use the selected control",
      mode: "desktop",
      observation: { desktop: desktopFixture(), window },
      actions: [
        { kind: "blocked", reason: "Stop" },
        {
          kind: "click_element",
          pid: window.pid,
          window_id: window.window_id,
          element_token: "control",
          reason: "Activate selected control",
        },
        { kind: "request_app", name: "Another", reason: "Open another application" },
      ],
    });
    expect(targets).toBe(0);
    expect(selected.action.kind).toBe("click_element");
    expect(selected.candidates?.map((action) => action.kind)).toEqual(["click_element"]);
    expect(selected.rejectedOperations).toHaveLength(1);
    expect(operations).toBeGreaterThan(1);
  } finally {
    await server.stop(true);
  }
});
