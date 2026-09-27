import { expect, test } from "bun:test";
import type { Action, ActionChoices } from "../src/agent/contracts.ts";
import { SystemOneDecisionModel } from "../src/models/system-one.ts";
import { decisionRequestSchema } from "../src/models/system-one-schema.ts";

const MAX_JULIA_CHOICES = 20;
const APP_COUNT = 40;
const TOO_MANY_APPS = 400;
const TARGET = "App 39";

function apps(count: number): ActionChoices {
  const [first, ...rest] = Array.from({ length: count }, (_unused, index): Action => ({
    kind: "request_app",
    name: `App ${index}`,
    reason: `Open App ${index}`,
  }));
  if (first === undefined) {
    throw new Error("At least one application is required.");
  }
  return [first, ...rest, { kind: "blocked", reason: "Blocked" }];
}
function answer(choice: string, keys: readonly string[]): Response {
  return Response.json({
    answers: {
      next_action: {
        choice,
        probabilities: Object.fromEntries(keys.map((key) => [key, Number(key === choice)])),
      },
    },
  });
}
const input = {
  task: `Open ${TARGET}`,
  mode: "desktop" as const,
  observation: { desktop: { apps: [], windows: [] } },
};
function selectedChoice(
  instructions: string,
  criteria: Readonly<Record<string, string>>,
  state: string,
): string {
  const keys = Object.keys(criteria);
  if (instructions.startsWith("Which operation")) {
    return keys.find((key) => criteria[key]?.includes("installed application") === true) ?? "A0";
  }
  if (instructions.startsWith("Which group")) {
    return (
      state
        .split("\n")
        .find((line) => /^A\d+:/u.test(line) && line.includes(TARGET))
        ?.split(":")[0] ?? "A0"
    );
  }
  return keys.find((key) => criteria[key]?.includes(TARGET) === true) ?? "A0";
}

test("pages exact app candidates within a declared twenty-choice limit", async () => {
  const counts: number[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = decisionRequestSchema.parse(await request.json());
      const { criteria, instructions } = body.questions.next_action;
      const keys = Object.keys(criteria);
      counts.push(keys.length);
      const choice = selectedChoice(instructions, criteria, body.state);
      return answer(choice, keys);
    },
  });
  try {
    const result = await new SystemOneDecisionModel(server.url.href, "julia-latest", {
      maxChoices: MAX_JULIA_CHOICES,
    }).choose({ ...input, actions: apps(APP_COUNT) });
    expect(result.action).toMatchObject({ kind: "request_app", name: TARGET });
    expect(counts.length).toBeGreaterThan(1);
    expect(counts.every((count) => count <= MAX_JULIA_CHOICES)).toBe(true);
    expect(result.candidates?.length).toBeLessThanOrEqual(MAX_JULIA_CHOICES - 1);
  } finally {
    await server.stop(true);
  }
});

test("reports when even the page choices exceed a model limit", async () => {
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = decisionRequestSchema.parse(await request.json());
      const keys = Object.keys(body.questions.next_action.criteria);
      const choice =
        keys.find(
          (key) =>
            body.questions.next_action.criteria[key]?.includes("installed application") === true,
        ) ?? "A0";
      return answer(choice, keys);
    },
  });
  try {
    let failure: unknown = new Error("Expected a choice-capacity error.");
    try {
      await new SystemOneDecisionModel(server.url.href, "julia-latest", {
        maxChoices: MAX_JULIA_CHOICES,
      }).choose({ ...input, actions: apps(TOO_MANY_APPS) });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    if (failure instanceof Error) {
      expect(failure.message).toContain("capacity_choices:");
      expect(failure.message).toContain("choice pages");
    }
  } finally {
    await server.stop(true);
  }
});

test("requires a real model choice for a sole action", async () => {
  let requests = 0;
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      requests += 1;
      const body = decisionRequestSchema.parse(await request.json());
      expect(Object.values(body.questions.next_action.criteria)).toEqual([
        `Open ${TARGET}`,
        "None of these actions; do not execute the sole remaining target.",
      ]);
      return answer("A0", Object.keys(body.questions.next_action.criteria));
    },
  });
  try {
    const result = await new SystemOneDecisionModel(server.url.href, "julia-latest", {
      maxChoices: MAX_JULIA_CHOICES,
    }).choose({
      ...input,
      actions: [{ kind: "request_app", name: TARGET, reason: `Open ${TARGET}` }],
    });
    expect(result.action).toMatchObject({ kind: "request_app", name: TARGET });
    expect(result.probabilities).toEqual({ A0: 1, A1: 0 });
    expect(requests).toBe(1);
  } finally {
    await server.stop(true);
  }
});
