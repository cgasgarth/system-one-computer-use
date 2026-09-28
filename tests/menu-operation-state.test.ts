import { expect, test } from "bun:test";
import type { ActionChoices } from "../src/agent/contracts.ts";
import { actionGroups, decisionState, operationState } from "../src/models/decision-context.ts";
import { SystemOneDecisionModel } from "../src/models/system-one.ts";
import type { DecisionInput } from "../src/models/system-one.ts";
import { decisionRequestSchema } from "../src/models/system-one-schema.ts";
import { desktopFixture, windowFixture } from "./fixtures.ts";

const fileOpen = {
  kind: "invoke_menu",
  pid: 7,
  window_id: 9,
  path: ["File", "Open"],
  reason: "Choose File > Open",
} as const;
const windowOpen = {
  kind: "invoke_menu",
  pid: 7,
  window_id: 9,
  path: ["Window", "Open"],
  reason: "Choose Window > Open",
} as const;
const fileClose = { ...fileOpen, path: ["File", "Close"], reason: "Choose File > Close" } as const;
const finish = { kind: "finish", reason: "Finish", summary: "Done" } as const;
const blocked = { kind: "blocked", reason: "Blocked" } as const;
const TARGET_SELECTIONS = 2;
const input: DecisionInput = {
  task: "Open an item",
  mode: "desktop",
  observation: {
    desktop: desktopFixture(),
    window: {
      ...windowFixture(),
      menus: [
        { path: ["File", "Open"], label: "Open", enabled: true },
        { path: ["Window", "Open"], label: "Open", enabled: true },
        { path: ["File", "Delete"], label: "Delete", enabled: false },
      ],
    },
  },
  actions: [fileOpen, windowOpen, finish, blocked],
};

test("operation inventory retains duplicate command leaves under their observed parents", () => {
  const state = operationState(input, input.actions);
  const [, inventory] = state.split("\nAvailable observed menu paths: ");
  expect(inventory).toBeDefined();
  expect(JSON.parse(inventory ?? "[]")).toEqual([
    { path: ["File"], commands: ["Open"] },
    { path: ["Window"], commands: ["Open"] },
  ]);
  expect(state).not.toContain("Delete");
});

test("menu operations group by offered top-level path without dropping targets", () => {
  const groups = actionGroups([fileOpen, windowOpen, fileClose]);
  expect(groups.map((group) => group.description)).toEqual([
    'Use a command in the observed "File" menu.',
    'Use a command in the observed "Window" menu.',
  ]);
  expect(groups.map((group) => group.kind)).toEqual(["invoke_menu", "invoke_menu"]);
  expect(groups[0]?.actions).toEqual([fileOpen, fileClose]);
  expect(groups[1]?.actions).toEqual([windowOpen]);
});

test("a menu-only window selects File before choosing its exact command", async () => {
  const appleAbout = {
    ...fileOpen,
    path: ["Apple", "About"],
    reason: "Choose Apple > About",
  } as const;
  const fileNew = {
    ...fileOpen,
    path: ["File", "New Item"],
    reason: "Choose File > New Item",
  } as const;
  const criteriaByPhase: string[][] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = decisionRequestSchema.parse(await request.json());
      const { criteria, instructions } = body.questions.next_action;
      const entries = Object.entries(criteria);
      criteriaByPhase.push(Object.values(criteria));
      let choice = "A1";
      if (instructions.startsWith("Which operation")) {
        choice = entries.find(([, value]) => value.includes('observed "File" menu'))?.[0] ?? "A0";
      } else if (instructions.startsWith("Which action")) {
        choice = entries.find(([, value]) => value.includes("File > New Item"))?.[0] ?? "A0";
      }
      return Response.json({
        answers: {
          next_action: {
            choice,
            probabilities: Object.fromEntries(
              entries.map(([key]) => [key, Number(key === choice)]),
            ),
          },
        },
      });
    },
  });
  try {
    const { window } = input.observation;
    if (window === undefined) {
      throw new Error("The menu fixture needs an observed window.");
    }
    const decision = await new SystemOneDecisionModel(server.url.href, "test").choose({
      ...input,
      observation: {
        ...input.observation,
        window: {
          ...window,
          elements: [],
          menus: [
            { path: ["Apple", "About"], label: "About", enabled: true },
            { path: ["File", "New Item"], label: "New Item", enabled: true },
            { path: ["File", "Open"], label: "Open", enabled: true },
          ],
        },
      },
      actions: [appleAbout, fileNew, fileOpen, blocked],
    });
    expect(decision.action).toMatchObject({ kind: "invoke_menu", path: ["File", "New Item"] });
    expect(criteriaByPhase[0]).toContain('Use a command in the observed "File" menu.');
    expect(criteriaByPhase[1]?.some((value) => value.includes("Apple > About"))).toBe(false);
    expect(criteriaByPhase[1]?.some((value) => value.includes("File > Open"))).toBe(true);
  } finally {
    await server.stop(true);
  }
});

test("an operation request without offered menus keeps its previous state bytes", () => {
  const actions: ActionChoices = [finish, blocked];
  expect(operationState({ ...input, actions }, actions)).toBe(decisionState({ ...input, actions }));
});

test("the target sees its selected operation, while full menu inventory stays operation-only", async () => {
  const states: string[] = [];
  const { window } = input.observation;
  if (window === undefined) {
    throw new Error("The menu fixture needs an observed window.");
  }
  const treatment: DecisionInput = {
    ...input,
    observation: {
      ...input.observation,
      window: {
        ...window,
        menus: [
          ...(window.menus ?? []),
          { path: ["File", "Close"], label: "Close", enabled: true },
        ],
      },
    },
    actions: [
      {
        kind: "compose_text",
        pid: 7,
        window_id: 9,
        element_token: "s1:1",
        reason: "Enter search",
      },
      fileOpen,
      fileClose,
      windowOpen,
      blocked,
    ],
  };
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = decisionRequestSchema.parse(await request.json());
      const { criteria, instructions } = body.questions.next_action;
      const keys = Object.keys(criteria);
      states.push(body.state);
      let choice = "A1";
      if (instructions.startsWith("Which operation")) {
        choice =
          keys.find((key) => criteria[key]?.includes('observed "File" menu') === true) ?? "A0";
      } else if (instructions.startsWith("Which action")) {
        choice = keys.find((key) => criteria[key]?.includes("File > Open") === true) ?? "A0";
      }
      return Response.json({
        answers: {
          next_action: {
            choice,
            probabilities: Object.fromEntries(keys.map((key) => [key, Number(key === choice)])),
          },
        },
      });
    },
  });
  try {
    const decision = await new SystemOneDecisionModel(server.url.href, "test").choose(treatment);
    expect(decision.action).toMatchObject({ kind: "invoke_menu", path: ["File", "Open"] });
    expect(states[0]).toContain("Available observed menu paths:");
    expect(states[1]).toContain("Current window: Messages: Messages");
    expect(states[1]).toContain(
      'Selected operation for this next step: Use a command in the observed "File" menu.',
    );
    expect(states[1]).not.toContain("Available observed menu paths:");
    expect(states.at(-1)).not.toContain("Available observed menu paths:");
  } finally {
    await server.stop(true);
  }
});

function retryInput(): DecisionInput {
  const { window } = input.observation;
  if (window === undefined) {
    throw new Error("The menu fixture needs an observed window.");
  }
  const actions: ActionChoices = [
    fileOpen,
    fileClose,
    { kind: "compose_text", pid: 7, window_id: 9, element_token: "s1:1", reason: "Enter Search" },
    { kind: "compose_text", pid: 7, window_id: 9, element_token: "other", reason: "Enter Other" },
    blocked,
  ];
  return {
    ...input,
    observation: {
      ...input.observation,
      window: {
        ...window,
        elements: [
          ...window.elements,
          {
            element_index: 2,
            element_token: "other",
            role: "textbox",
            label: "Other",
            value: "",
            editable: true,
          },
        ],
        menus: [
          ...(window.menus ?? []),
          { path: ["File", "Close"], label: "Close", enabled: true },
        ],
      },
    },
    actions,
  };
}

test("a rejected menu operation does not contaminate the next target choice", async () => {
  const targetStates: string[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = decisionRequestSchema.parse(await request.json());
      const { criteria, instructions } = body.questions.next_action;
      const keys = Object.keys(criteria);
      let choice = "A0";
      if (instructions.startsWith("Which operation")) {
        const textGroup = keys.find(
          (key) => criteria[key]?.includes("Enter or replace text") === true,
        );
        const fileGroup = keys.find(
          (key) => criteria[key]?.includes('observed "File" menu') === true,
        );
        choice = targetStates.length === 0 ? (fileGroup ?? "A0") : (textGroup ?? "A0");
      } else if (instructions.startsWith("Which action")) {
        targetStates.push(body.state);
        if (targetStates.length === 1) {
          choice =
            keys.find((key) => criteria[key]?.includes("choose another operation") === true) ??
            "A0";
        }
      }
      return Response.json({
        answers: {
          next_action: {
            choice,
            probabilities: Object.fromEntries(keys.map((key) => [key, Number(key === choice)])),
          },
        },
      });
    },
  });
  try {
    const decision = await new SystemOneDecisionModel(server.url.href, "test").choose(retryInput());
    expect(decision.action.kind).toBe("compose_text");
    expect(targetStates).toHaveLength(TARGET_SELECTIONS);
    expect(targetStates[0]).toContain(
      'Selected operation for this next step: Use a command in the observed "File" menu.',
    );
    expect(targetStates[1]).toContain(
      "Selected operation for this next step: Enter or replace text in an editable field.",
    );
    expect(targetStates[1]).not.toContain(
      'Selected operation for this next step: Use a command in the observed "File" menu.',
    );
  } finally {
    await server.stop(true);
  }
});
