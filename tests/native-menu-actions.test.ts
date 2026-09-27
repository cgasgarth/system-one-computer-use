import { expect, test } from "bun:test";
import { options } from "../src/agent/options.ts";
import type { ActionChoices } from "../src/agent/contracts.ts";
import { verifyCommit } from "../src/models/commit-verification.ts";
import { actionGroups } from "../src/models/decision-context.ts";
import { desktopFixture, windowFixture } from "./fixtures.ts";

const menuAction = {
  kind: "invoke_menu",
  pid: 7,
  window_id: 9,
  path: ["File", "Open"],
  reason: "Choose menu File > Open",
} as const;
const FILE_GROUP_COUNT = 2;
const window = {
  ...windowFixture(),
  menus: [{ path: ["File", "Open"], label: "Open", enabled: true }],
};
const observation = { desktop: desktopFixture(), window };

test("offers only a unique enabled menu path observed in the current window", () => {
  const offered = options({ mode: "desktop", applications: [], observation });
  expect(
    offered.some(
      (action) => action.kind === "invoke_menu" && action.path.join(" > ") === "File > Open",
    ),
  ).toBe(true);
  const duplicate = options({
    mode: "desktop",
    applications: [],
    observation: {
      ...observation,
      window: { ...window, menus: [...window.menus, ...window.menus] },
    },
  });
  expect(duplicate.some((action) => action.kind === "invoke_menu")).toBe(false);
  const disabled = options({
    mode: "desktop",
    applications: [],
    observation: {
      ...observation,
      window: {
        ...window,
        menus: [{ path: ["File", "Open"], label: "Open", enabled: false }],
      },
    },
  });
  expect(disabled.some((action) => action.kind === "invoke_menu")).toBe(false);
});

test("a persistent menu command requires a separate task authorization", async () => {
  const actions: ActionChoices = [menuAction, { kind: "blocked", reason: "Stop" }];
  const questions: string[] = [];
  const result = await verifyCommit({
    action: menuAction,
    input: { task: "Show the current item", actions, observation, mode: "desktop" },
    model: "test-model",
    async judge(request) {
      questions.push(request.questions.next_action.instructions);
      return questions.length === 1
        ? { choice: "A0", probabilities: { A0: 1, A1: 0 } }
        : { choice: "A1", probabilities: { A0: 0, A1: 1 } };
    },
  });
  expect(result.allowed).toBe(false);
  expect(result.checks.map((check) => check.phase)).toEqual([
    "commit-classification",
    "commit-authorization",
  ]);
});

test("menu choices are grouped by their observed top-level menu", () => {
  const groups = actionGroups([
    menuAction,
    { ...menuAction, path: ["File", "Close"], reason: "Choose menu File > Close" },
    { ...menuAction, path: ["Edit", "Copy"], reason: "Choose menu Edit > Copy" },
  ]);
  expect(groups.map((group) => group.actions.length)).toEqual([FILE_GROUP_COUNT, 1]);
  expect(groups.map((group) => group.description)).toEqual([
    "Choose an enabled command in the observed File menu.",
    "Choose an enabled command in the observed Edit menu.",
  ]);
});
