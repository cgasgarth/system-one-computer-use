import { expect, test } from "bun:test";
import type { DecisionInput } from "../src/models/system-one.ts";
import { verifyCommit } from "../src/models/commit-verification.ts";
import { executeInput } from "../src/agent/surface.ts";
import type { Window } from "../src/agent/contracts.ts";
import type { Computer } from "../src/computer/types.ts";
import { desktopFixture, windowFixture } from "./fixtures.ts";

const yes = { choice: "A0", probabilities: { A0: 1, A1: 0 } } as const;
const no = { choice: "A1", probabilities: { A0: 0, A1: 1 } } as const;
const key = {
  kind: "press_key",
  pid: 7,
  window_id: 9,
  element_token: "s1:1",
  key: "return",
  modifiers: [],
  reason: "Press Return",
} as const;
function input(focused = true): DecisionInput {
  const base = windowFixture();
  const [field] = base.elements;
  if (field === undefined) {
    throw new Error("Missing test field");
  }
  const window = {
    ...base,
    elements: [
      { ...field, value: "query", focused },
      {
        element_index: 2,
        element_token: "save",
        role: "button",
        label: "Save",
        actions: ["AXPress"],
      },
    ],
  };
  return {
    task: "Submit this value",
    observation: { desktop: desktopFixture(), window },
    actions: [key],
  };
}
function fakeComputer(read: () => Promise<Window>, press: () => Promise<void>): Computer {
  return {
    async desktop() {
      return desktopFixture();
    },
    window: read,
    async launchApp() {
      throw new Error("Unexpected app launch");
    },
    async clickElement() {
      throw new Error("Unexpected click");
    },
    async inspectClick() {
      return { kind: "unclassified" };
    },
    async typeText() {
      throw new Error("Unexpected text input");
    },
    pressKey: press,
  };
}

test("Return needs authorization even with another clickable control", async () => {
  const phases: string[] = [];
  const result = await verifyCommit({
    action: key,
    input: input(),
    model: "model",
    async judge(_request, phase) {
      phases.push(phase);
      return no;
    },
  });
  expect(result.allowed).toBe(false);
  expect(result.checks.map((check) => [check.phase, check.source])).toEqual([
    ["commit-classification", "conservative"],
    ["commit-authorization", undefined],
  ]);
  expect(phases).toEqual(["commit-authorization"]);
});

test("authorized Return still checks observed field readiness", async () => {
  const phases: string[] = [];
  const result = await verifyCommit({
    action: key,
    input: input(),
    model: "model",
    async judge(request, phase) {
      phases.push(phase);
      expect(request.questions.next_action.instructions).toContain(
        phase === "field-readiness" ? "field" : "Return key",
      );
      return phase === "field-readiness" ? no : yes;
    },
  });
  expect(result.allowed).toBe(true);
  expect(phases).toEqual(["commit-authorization", "field-readiness"]);
});

test("stale focus blocks Return before authorization; Tab stays nonpersistent", async () => {
  const stale = await verifyCommit({
    action: key,
    input: input(false),
    model: "model",
    async judge() {
      throw new Error("A stale focus must not reach the model");
    },
  });
  expect(stale.allowed).toBe(false);
  const tab = await verifyCommit({
    action: { ...key, key: "tab" },
    input: input(),
    model: "model",
    async judge() {
      throw new Error("Tab must not request persistent authorization");
    },
  });
  expect(tab).toEqual({ allowed: true, checks: [] });
});

test("fresh key delivery accepts a regenerated token for the same focused field", async () => {
  const selected = input().observation;
  const [field] = windowFixture().elements;
  if (field === undefined) {
    throw new Error("Missing test field");
  }
  const fresh = {
    ...windowFixture(),
    elements: [{ ...field, element_token: "s2:field", value: "query", focused: true }],
  };
  let presses = 0;
  const computer = fakeComputer(
    async () => fresh,
    async () => {
      presses += 1;
    },
  );
  await executeInput(computer, key, { observation: selected });
  expect(presses).toBe(1);
});

test("fresh key delivery rejects wrong focus and caller Stop", async () => {
  const selected = input().observation;
  const [field] = windowFixture().elements;
  if (field === undefined) {
    throw new Error("Missing test field");
  }
  const controller = new AbortController();
  let presses = 0;
  const wrongFocus = {
    ...windowFixture(),
    elements: [
      {
        ...field,
        element_token: "other",
        role: "textbox",
        subrole: undefined,
        label: "Compose",
        value: "query",
        focused: true,
      },
    ],
  };
  const computer = fakeComputer(
    async () => wrongFocus,
    async () => {
      presses += 1;
    },
  );
  let rejected = false;
  try {
    await executeInput(computer, key, { observation: selected });
  } catch {
    rejected = true;
  }
  expect(rejected).toBe(true);
  const stoppedComputer = fakeComputer(
    async () => {
      controller.abort();
      return { ...windowFixture(), elements: [{ ...field, value: "query", focused: true }] };
    },
    async () => {
      presses += 1;
    },
  );
  rejected = false;
  try {
    await executeInput(stoppedComputer, key, { observation: selected, signal: controller.signal });
  } catch {
    rejected = true;
  }
  expect(rejected).toBe(true);
  expect(presses).toBe(0);
});
