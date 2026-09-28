import { expect, test } from "bun:test";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { options } from "../src/agent/options.ts";
import type { ActionChoices } from "../src/agent/contracts.ts";
import { readNativeMenus } from "../src/computer/native-access.ts";
import { verifyCommit } from "../src/models/commit-verification.ts";
import { actionGroups } from "../src/models/decision-context.ts";
import { desktopFixture, expectFailure, windowFixture } from "./fixtures.ts";

const menuAction = {
  kind: "invoke_menu",
  pid: 7,
  window_id: 9,
  path: ["File", "Open"],
  reason: "Choose menu File > Open",
} as const;
const FILE_GROUP_COUNT = 2;
const EXECUTABLE_MODE = 0o700;
const TEST_PID = 7;
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

test("offers read-only inspection for observed top-level menus even when commands are disabled", () => {
  const observed = {
    ...observation,
    window: {
      ...window,
      menuNames: ["File", "Edit"],
      menus: [{ path: ["File", "Open"], label: "Open", enabled: false }],
    },
  };
  const offered = options({ mode: "desktop", applications: [], observation: observed });
  expect(
    offered.filter((action) => action.kind === "inspect_menu").map((action) => action.topLevel),
  ).toEqual(["File", "Edit"]);
  expect(offered.some((action) => action.kind === "invoke_menu")).toBe(false);
  expect(
    options({ mode: "desktop", applications: [], observation }).some(
      (action) => action.kind === "inspect_menu",
    ),
  ).toBe(false);
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

test("observed menu commands retain exact paths within their top-level groups", () => {
  const groups = actionGroups([
    menuAction,
    { ...menuAction, path: ["File", "Close"], reason: "Choose menu File > Close" },
    { ...menuAction, path: ["Edit", "Copy"], reason: "Choose menu Edit > Copy" },
  ]);
  expect(groups.map((group) => group.actions.length)).toEqual([FILE_GROUP_COUNT, 1]);
  expect(groups.map((group) => group.description)).toEqual([
    'Use a command in the observed "File" menu.',
    'Use a command in the observed "Edit" menu.',
  ]);
  expect(groups.flatMap((group) => group.actions).map((action) => action.reason)).toEqual([
    "Choose menu File > Open",
    "Choose menu File > Close",
    "Choose menu Edit > Copy",
  ]);
});

test("scoped native inspection reads File even when a noisy global scan omitted its leaves", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "system-one-menu-read-"));
  const binary = path.join(directory, "menus");
  await Bun.write(
    binary,
    `#!${process.execPath}\nconst top=Bun.argv.at(-1); if(top==="Edit"){console.error("The selected top-level menu is missing or ambiguous.");process.exit(1)} const menus=top==="File"?[{path:["File","Open"],label:"Open",enabled:true},{path:["File","Close"],label:"Close",enabled:false}]:[{path:["Apple","About"],label:"About",enabled:true}]; console.log(JSON.stringify({pid:7,menuNames:["Apple","File"],menus,complete:top==="File"}));\n`,
  );
  await chmod(binary, EXECUTABLE_MODE);
  try {
    const global = await readNativeMenus(binary, TEST_PID);
    const file = await readNativeMenus(binary, TEST_PID, "File");
    expect(global.complete).toBe(false);
    expect(global.menuNames).toContain("File");
    expect(global.menus.some((menu) => menu.path[0] === "File")).toBe(false);
    expect(file.complete).toBe(true);
    expect(file.menus.map((menu) => [menu.path, menu.enabled])).toEqual([
      [["File", "Open"], true],
      [["File", "Close"], false],
    ]);
    await expectFailure(readNativeMenus(binary, TEST_PID, "Edit"), "missing or ambiguous");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
