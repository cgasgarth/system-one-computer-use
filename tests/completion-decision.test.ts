import { expect, test } from "bun:test";
import type { ActionChoices } from "../src/agent/contracts.ts";
import { SystemOneHttpDecisionModel } from "../src/models/system-one.ts";
import { decisionRequestSchema } from "../src/models/system-one-schema.ts";
import { desktopFixture, expectFailure, windowFixture } from "./fixtures.ts";

const BINARY_MIDPOINT = 0.5;
const cases: { readonly probability: number; readonly expected: "finish" | "press_key" }[] = [
  { probability: 0.95, expected: "finish" },
  { probability: 0.51, expected: "press_key" },
  { probability: 0.49, expected: "press_key" },
];
function choices(): ActionChoices {
  const target = windowFixture();
  return [
    {
      kind: "press_key",
      key: "return",
      modifiers: [],
      pid: target.pid,
      window_id: target.window_id,
      reason: "Press return",
    },
    { kind: "finish", reason: "Task is complete", summary: "Done" },
    { kind: "blocked", reason: "Need help" },
  ];
}
test.each(cases)(
  "checks observed completion with probability $probability",
  async ({ probability, expected }) => {
    let requests = 0;
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        requests += 1;
        const body = decisionRequestSchema.parse(await request.json());

        expect(body.state).toContain("Find Alex in Messages");
        expect(body.state).toContain("Search");
        expect(body.state).toContain("Search has not been submitted");
        const checking =
          body.questions.next_action.instructions.startsWith("Has this user request");
        return Response.json({
          answers: {
            next_action: checking
              ? {
                  choice: probability > BINARY_MIDPOINT ? "A0" : "A1",
                  probabilities: { A0: probability, A1: 1 - probability },
                }
              : { choice: "A0", probabilities: { A0: 1, A1: 0 } },
          },
        });
      },
    });
    try {
      const result = await new SystemOneHttpDecisionModel(server.url.href, "any-model").choose({
        task: "Find Alex in Messages",
        context: "Search has not been submitted",
        observation: { desktop: desktopFixture(), window: windowFixture() },
        actions: choices(),
        mode: "desktop",
      });
      const completionAndActionRequests = 2;
      expect(requests).toBe(completionAndActionRequests);
      expect(result.action.kind).toBe(expected);
      expect(result.completion?.probabilities["A0"]).toBe(probability);
      if (expected !== "finish") {
        expect(result.candidates?.map((action) => action.kind)).toEqual(["press_key", "blocked"]);
      }
    } finally {
      await server.stop(true);
    }
  },
);

test.each([{ choice: "A0", probabilities: { A0: 0.2, A1: 0 } }])(
  "rejects invalid completion data",
  async (completion) => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return Response.json({
          answers: { next_action: completion },
        });
      },
    });
    try {
      await expectFailure(
        new SystemOneHttpDecisionModel(server.url.href, "model").choose({
          task: "Open Messages",
          observation: { desktop: desktopFixture(), window: windowFixture() },
          actions: choices(),
        }),
        "invalid completion decision",
      );
    } finally {
      await server.stop(true);
    }
  },
);

test("requires an observed target before accepting a Finish choice", async () => {
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = decisionRequestSchema.parse(await request.json());
      expect(body.state).toContain("Open Calendar");
      return Response.json({
        answers: { next_action: { choice: "A0", probabilities: { A0: 0.99, A1: 0.01 } } },
      });
    },
  });
  try {
    const result = await new SystemOneHttpDecisionModel(server.url.href, "test").choose({
      task: "Open Calendar",
      feedback: "Last tool error: Accessibility permission is missing.",
      observation: { desktop: { apps: [], windows: [] } },
      actions: [
        { kind: "finish", reason: "Complete", summary: "Done" },
        { kind: "blocked", reason: "Access is required" },
      ],
    });
    expect(result.action.kind).toBe("blocked");
  } finally {
    await server.stop(true);
  }
});

test.each([
  { task: "Create the project", commit: "A0", expected: "press_key" },
  { task: "Leave this draft open", commit: "A1", expected: "finish" },
] as const)(
  "checks whether a filled dialog is the requested final state: $task",
  async ({ task, commit, expected }) => {
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const body = decisionRequestSchema.parse(await request.json());
        const question = body.questions.next_action.instructions;
        const choice = question.includes("committed change") ? commit : "A0";
        return Response.json({
          answers: {
            next_action: {
              choice,
              probabilities: choice === "A0" ? { A0: 0.95, A1: 0.05 } : { A0: 0.05, A1: 0.95 },
            },
          },
        });
      },
    });
    try {
      const window = {
        ...windowFixture(),
        elements: [
          { element_index: 0, element_token: "dialog", role: "dialog", label: "Editor" },
          {
            element_index: 1,
            parent_index: 0,
            element_token: "field",
            role: "textbox",
            label: "Project name",
            value: "Draft",
            editable: true,
          },
        ],
      };
      const result = await new SystemOneHttpDecisionModel(server.url.href, "model").choose({
        task,
        observation: { desktop: desktopFixture(), window },
        actions: choices(),
      });
      expect(result.action.kind).toBe(expected);
      expect(result.completionCommit?.choice).toBe(commit);
    } finally {
      await server.stop(true);
    }
  },
);
