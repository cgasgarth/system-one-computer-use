import { expect, test } from "bun:test";
import type { ActionChoices } from "../src/agent/contracts.ts";
import { SystemOneHttpDecisionModel } from "../src/models/system-one.ts";
import { decisionRequestSchema } from "../src/models/system-one-schema.ts";
import { desktopFixture, expectFailure, windowFixture } from "./fixtures.ts";

const BINARY_MIDPOINT = 0.5;
const LONG_REQUEST_REPEATS = 200;
const LONG_CONTEXT_REPEATS = 100;
const LONG_PRIOR_REPEATS = 400;
const MAX_COMMIT_TEST_CHARS = 5000;
const FINAL_CONSTRAINT = "Final constraint: do not save any other project.";
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
        const choice = question.includes("persistent result") ? commit : "A0";
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

test.each([
  {
    result: "canceled",
    prior: "A0",
    priorProbability: 0.54,
    commit: "A0",
    expected: "press_key",
    recheck: true,
  },
  {
    result: "saved",
    prior: "A0",
    priorProbability: 0.54,
    commit: "A1",
    expected: "finish",
    recheck: true,
  },
  {
    result: "uncertain",
    prior: "A1",
    priorProbability: 0.65,
    commit: "A0",
    expected: "press_key",
    recheck: true,
  },
  {
    result: "saved",
    prior: "A1",
    priorProbability: 0.95,
    commit: "A1",
    expected: "finish",
    recheck: false,
  },
] as const)(
  "handles an earlier result assessment after the dialog closes: $result $prior $priorProbability",
  async ({ result, prior, priorProbability, commit, expected, recheck }) => {
    const seen: string[] = [];
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const body = decisionRequestSchema.parse(await request.json());
        const question = body.questions.next_action.instructions;
        if (question.includes("persistent result")) {
          seen.push(body.state);
        }
        const choice = question.includes("persistent result") ? commit : "A0";
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
      const resultWindow = {
        ...windowFixture(),
        window_title: result === "saved" ? "Project created" : "Projects",
        elements:
          result === "saved"
            ? [
                {
                  element_index: 0,
                  element_token: "project",
                  role: "heading",
                  label: "New project",
                },
              ]
            : windowFixture().elements,
      };
      const answer = await new SystemOneHttpDecisionModel(server.url.href, "model").choose({
        task: `Create New project ${"detail ".repeat(LONG_REQUEST_REPEATS)} ${FINAL_CONSTRAINT}`,
        observation: { desktop: desktopFixture(), window: resultWindow },
        actions: choices(),
        context: "Earlier session context ".repeat(LONG_CONTEXT_REPEATS),
        completionEvidence: `A click on ${result === "saved" ? "Save" : "Cancel"} returned successfully. A subsequent observation shows the dialog changed from open to closed. ${"Later effect ".repeat(LONG_REQUEST_REPEATS)}`,
        priorCompletionCommit: {
          answer: {
            choice: prior,
            probabilities:
              prior === "A0"
                ? { A0: priorProbability, A1: 1 - priorProbability }
                : { A0: 1 - priorProbability, A1: priorProbability },
          },
          observedState: `The project editor was open with a filled Project name field. ${"Old control ".repeat(LONG_PRIOR_REPEATS)}`,
          stepIndex: 2,
        },
      });
      expect(answer.action.kind).toBe(expected);
      expect(answer.completionCommit?.choice).toBe(recheck ? commit : undefined);
      expect(seen).toHaveLength(recheck ? 1 : 0);
      if (recheck) {
        expect(seen[0]).toContain(`Earlier assessment in this request at step 2: ${prior}`);
        expect(seen[0]).toContain(JSON.stringify(priorProbability));
        expect(seen[0]).toContain("dialog changed from open to closed");
        expect(seen[0]).toContain(resultWindow.window_title);
        expect(seen[0]).toContain(FINAL_CONSTRAINT);
        expect(seen[0]).toContain("characters omitted from this excerpt");
        expect(seen[0]?.length).toBeLessThan(MAX_COMMIT_TEST_CHARS);
      }
    } finally {
      await server.stop(true);
    }
  },
);
