import { expect, test } from "bun:test";
import type { ActionChoices } from "../src/agent/contracts.ts";
import { ActionSelectionError } from "../src/models/action-selection-error.ts";
import { SystemOneDecisionModel } from "../src/models/system-one.ts";
import { decisionRequestSchema } from "../src/models/system-one-schema.ts";
import { desktopFixture } from "./fixtures.ts";

const actions: ActionChoices = [
  { kind: "click_element", pid: 7, window_id: 9, element_token: "save", reason: "Activate Save" },
  { kind: "click_element", pid: 7, window_id: 9, element_token: "next", reason: "Open Next" },
  { kind: "finish", reason: "Finish", summary: "Done" },
  { kind: "blocked", reason: "Blocked" },
];
const RETRY_REQUESTS = 2;
const SOLE_ACTION_OPTIONS = 2;
const observation = {
  desktop: desktopFixture(),
  window: {
    app_name: "Test",
    pid: 7,
    window_id: 9,
    window_title: "Draft",
    snapshot_id: "one",
    elements: [
      {
        element_index: 1,
        element_token: "save",
        role: "button",
        label: "Save",
        actions: ["AXPress"],
      },
      {
        element_index: 2,
        element_token: "next",
        role: "link",
        label: "Next",
        actions: ["AXPress"],
      },
    ],
  },
};
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
test("a rejected direct Save removes only Save and keeps other actions", async () => {
  const direct: { readonly criteria: readonly string[]; readonly state: string }[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = decisionRequestSchema.parse(await request.json());
      const { instructions, criteria } = body.questions.next_action;
      if (instructions.startsWith("Which action best advances")) {
        direct.push({ criteria: Object.values(criteria), state: body.state });
        return response("A0", criteria);
      }
      return response("A1", criteria);
    },
  });
  try {
    const result = await new SystemOneDecisionModel(server.url.href, "model").choose({
      task: "Save the draft, then open Next",
      observation,
      actions,
      async inspectClick(action) {
        return { kind: action.element_token === "save" ? "form_submit" : "non_submit" };
      },
    });
    expect(result.action).toMatchObject({ kind: "click_element", element_token: "next" });
    expect(direct).toHaveLength(RETRY_REQUESTS);
    expect(direct[0]?.criteria).toHaveLength(actions.length);
    expect(direct[1]?.criteria).toHaveLength(actions.length - 1);
    expect(direct[1]?.criteria.some((item) => item.includes('button "Save"'))).toBe(false);
    expect(direct[1]?.criteria.some((item) => item.includes("Finish"))).toBe(true);
    expect(direct[1]?.criteria.some((item) => item.includes("Blocked"))).toBe(true);
    expect(direct[1]?.state).toContain("authorization for its stored effect was not established");
    expect(result.checks?.map((check) => check.phase)).toEqual([
      "form-semantics",
      "commit-authorization",
      "commit-classification",
    ]);
    expect(result.rejectedActions).toMatchObject([
      { action: { kind: "click_element", element_token: "save" } },
    ]);
    expect(result.probabilities).toEqual({ A0: 1, A1: 0, A2: 0 });
  } finally {
    await server.stop(true);
  }
});

test("retains a stale rejected target with no model checks in the selected trace", async () => {
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = decisionRequestSchema.parse(await request.json());
      return response("A0", body.questions.next_action.criteria);
    },
  });
  try {
    const result = await new SystemOneDecisionModel(server.url.href, "model").choose({
      task: "Open the requested view",
      observation,
      actions: [
        {
          kind: "click_element",
          pid: 7,
          window_id: 9,
          element_token: "gone",
          reason: "Open missing control",
        },
        { kind: "finish", reason: "Finish", summary: "Done" },
      ],
    });
    expect(result.action.kind).toBe("finish");
    expect(result.checks).toEqual([]);
    const [rejected] = result.rejectedActions ?? [];
    expect(rejected?.action).toMatchObject({ element_token: "gone" });
    expect(rejected?.reason).toContain("not executed");
    expect(result.candidates?.map((action) => action.kind)).toEqual(["finish"]);
  } finally {
    await server.stop(true);
  }
});

test("terminal exhaustion serializes a rejected target even without checks", async () => {
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = decisionRequestSchema.parse(await request.json());
      return response("A0", body.questions.next_action.criteria);
    },
  });
  try {
    let failure: unknown = "Expected action selection exhaustion.";
    try {
      await new SystemOneDecisionModel(server.url.href, "model").choose({
        task: "Open the requested view",
        observation,
        actions: [
          {
            kind: "click_element",
            pid: 7,
            window_id: 9,
            element_token: "gone",
            reason: "Open missing control",
          },
        ],
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(ActionSelectionError);
    if (failure instanceof ActionSelectionError) {
      expect(failure.toJSON().checks).toEqual([]);
      const [rejected] = failure.toJSON().rejectedActions;
      expect(rejected?.action).toMatchObject({ element_token: "gone" });
      expect(rejected?.reason).toContain("not executed");
    }
  } finally {
    await server.stop(true);
  }
});

test("a model can reject the only remaining action without executing it", async () => {
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = decisionRequestSchema.parse(await request.json());
      expect(Object.values(body.questions.next_action.criteria)).toHaveLength(SOLE_ACTION_OPTIONS);
      return response("A1", body.questions.next_action.criteria);
    },
  });
  try {
    let failure: unknown = "Expected model-owned rejection.";
    try {
      await new SystemOneDecisionModel(server.url.href, "model").choose({
        task: "Open Next",
        observation,
        actions: [
          {
            kind: "click_element",
            pid: 7,
            window_id: 9,
            element_token: "next",
            reason: "Open Next",
          },
        ],
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(ActionSelectionError);
  } finally {
    await server.stop(true);
  }
});
