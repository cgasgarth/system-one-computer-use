import { expect, test } from "bun:test";
import type { Action, MenuInspection } from "../src/agent/contracts.ts";
import { runTask } from "../src/agent/loop.ts";
import { SurfaceSession } from "../src/agent/surface.ts";
import { decisionState, operationState } from "../src/models/decision-context.ts";
import { serializeMenuInspection } from "../src/models/menu-inspection.ts";
import type { Decision, DecisionInput } from "../src/models/system-one.ts";
import type { ManagedComputer } from "../src/computer/types.ts";
import { computerFixture, windowFixture } from "./fixtures.ts";

const REPORT: MenuInspection = {
  pid: 7,
  window_id: 9,
  topLevel: "File",
  complete: false,
  menus: [
    { path: ["File", "Open"], label: "Open", enabled: true, shortcut: "o" },
    { path: ["File", "Close"], label: "Close", enabled: false },
  ],
};
const INSPECT_CHOICE = 2;
const EDIT_CHOICE = 3;
const MANY_COMMANDS = 100;
const COMMAND_WORD_REPEATS = 5;
function choose(input: DecisionInput, kind: Action["kind"], topLevel?: string): Decision {
  const action = input.actions.find(
    (item) => item.kind === kind && (item.kind !== "inspect_menu" || item.topLevel === topLevel),
  );
  if (action === undefined) {
    throw new Error(`Missing observed ${kind} choice`);
  }
  return { action, latencyMs: 0, probabilities: { A0: 1 } };
}
function computer(failEdit = false): {
  readonly driver: ManagedComputer;
  readonly calls: { inspected: string[]; invoked: string[]; keys: string[]; windows: number };
} {
  const calls = {
    inspected: [] as string[],
    invoked: [] as string[],
    keys: [] as string[],
    windows: 0,
  };
  const base = computerFixture().computer;
  const driver: ManagedComputer = {
    ...base,
    async desktop() {
      return {
        apps: [{ name: "Example", pid: 7 }],
        windows: [{ app_name: "Example", pid: 7, window_id: 9, title: "Example" }],
      };
    },
    async window() {
      calls.windows += 1;
      return {
        ...windowFixture(),
        app_name: "Example",
        window_title: "Example",
        menus: [{ path: ["Apple", "About"], label: "About", enabled: true }],
        menuNames: ["Apple", "File", "Edit"],
        menuComplete: false,
      };
    },
    async inspectMenu(action, currentWindow) {
      calls.inspected.push(action.topLevel);
      if (currentWindow !== undefined) {
        expect(currentWindow.pid).toBe(action.pid);
        expect(currentWindow.window_id).toBe(action.window_id);
      }
      if (failEdit && action.topLevel === "Edit") {
        throw new Error("The selected Edit menu became unavailable");
      }
      return action.topLevel === "File"
        ? REPORT
        : { ...REPORT, topLevel: action.topLevel, menus: [] };
    },
    async invokeMenu(action) {
      calls.invoked.push(action.path.join(" > "));
    },
    async pressKey(action) {
      calls.keys.push(action.key);
    },
  };
  return { driver, calls };
}

test("inspection is read-only, traces the full report, and exposes fresh scoped commands", async () => {
  const { driver, calls } = computer();
  let choices = 0;
  const result = await runTask({
    task: "View the File menu",
    preferredSurface: "desktop",
    applications: ["Example"],
    computer: () => driver,
    text: {
      async generate() {
        return "";
      },
    },
    decision: {
      async choose(input) {
        choices += 1;
        if (choices === 1) {
          return choose(input, "request_app");
        }
        if (choices === INSPECT_CHOICE) {
          return choose(input, "inspect_menu", "File");
        }
        expect(input.observation.menuInspection).toEqual(REPORT);
        expect(
          input.observation.window?.menus?.some((menu) => menu.path.join(" > ") === "File > Open"),
        ).toBe(true);
        expect(
          input.actions.some(
            (action) => action.kind === "invoke_menu" && action.path.join(" > ") === "File > Open",
          ),
        ).toBe(true);
        expect(
          input.actions.some(
            (action) => action.kind === "invoke_menu" && action.path.join(" > ") === "File > Close",
          ),
        ).toBe(false);
        const state = decisionState(input);
        expect(state).toContain('Read-only application menu "File"');
        expect(operationState(input, input.actions)).toContain(
          "Observed application menu inventory is incomplete",
        );
        expect(state).toContain('"leaf":"Open"');
        expect(state).toContain('"enabled":false');
        expect(state).toContain('"keyCharacter":"o"');
        return choose(input, "blocked");
      },
    },
  });
  expect(result.steps.map((step) => step.action.kind)).toEqual([
    "request_app",
    "inspect_menu",
    "blocked",
  ]);
  expect(result.steps[1]?.menuInspection).toEqual(REPORT);
  expect(result.steps[1]?.output).toContain("read-only");
  expect(result.steps[1]?.output).toContain("incomplete");
  expect(calls.inspected).toEqual(["File", "File"]);
  expect(calls.windows).toBe(INSPECT_CHOICE);
  expect(calls.invoked).toEqual([]);
  expect(calls.keys).toEqual([]);
});

test("a failed inspection of another menu clears the prior scoped report", async () => {
  const { driver, calls } = computer(true);
  let choices = 0;
  const result = await runTask({
    task: "Inspect the available menus",
    preferredSurface: "desktop",
    applications: ["Example"],
    computer: () => driver,
    text: {
      async generate() {
        return "";
      },
    },
    decision: {
      async choose(input) {
        choices += 1;
        if (choices === 1) {
          return choose(input, "request_app");
        }
        if (choices === INSPECT_CHOICE) {
          return choose(input, "inspect_menu", "File");
        }
        if (choices === EDIT_CHOICE) {
          return choose(input, "inspect_menu", "Edit");
        }
        expect(input.observation.menuInspection).toBeUndefined();
        expect(decisionState(input)).not.toContain('Read-only application menu "File"');
        return choose(input, "blocked");
      },
    },
  });
  expect(result.steps[2]?.error).toContain("Edit menu became unavailable");
  expect(calls.inspected).toEqual(["File", "File", "Edit"]);
  expect(calls.invoked).toEqual([]);
  expect(calls.keys).toEqual([]);
});

test("a mismatched refreshed menu is discarded with a visible error", async () => {
  const { driver } = computer();
  const inspected = driver.inspectMenu;
  if (inspected === undefined) {
    throw new Error("The fixture needs native menu inspection.");
  }
  const changed: ManagedComputer = {
    ...driver,
    async inspectMenu(action, currentWindow) {
      const report = await inspected(action, currentWindow);
      return currentWindow === undefined ? report : { ...report, topLevel: "Edit" };
    },
  };
  let choices = 0;
  const result = await runTask({
    task: "View the File menu",
    preferredSurface: "desktop",
    applications: ["Example"],
    computer: () => changed,
    text: {
      async generate() {
        return "";
      },
    },
    decision: {
      async choose(input) {
        choices += 1;
        if (choices === 1) {
          return choose(input, "request_app");
        }
        if (choices === INSPECT_CHOICE) {
          return choose(input, "inspect_menu", "File");
        }
        expect(input.observation.menuInspection).toBeUndefined();
        expect(input.observation.menuInspectionError).toContain("another window or menu");
        expect(decisionState(input)).toContain("Menu inspection unavailable:");
        return choose(input, "blocked");
      },
    },
  });
  expect(result.steps[1]?.menuInspection).toEqual(REPORT);
  expect(result.steps.at(-1)?.observation).toContain("menuInspectionError");
});

test("changing the selected window clears the inspected menu scope", async () => {
  const { driver, calls } = computer();
  const session = new SurfaceSession();
  session.mode = "desktop";
  session.selectApplication({ name: "Example", pid: 7 });
  session.setTarget({ pid: REPORT.pid, windowId: REPORT.window_id });
  session.setMenuInspection(REPORT);
  session.setTarget({ pid: REPORT.pid, windowId: REPORT.window_id + 1 });
  session.setTarget({ pid: REPORT.pid, windowId: REPORT.window_id });
  const observation = await session.observe(() => driver);
  expect(observation.menuInspection).toBeUndefined();
  expect(calls.inspected).toEqual([]);
});

test("large inspected menus fail explicitly instead of losing commands", () => {
  const menus = Array.from({ length: MANY_COMMANDS }, (_unused, index) => ({
    path: ["File", `${"Long command ".repeat(COMMAND_WORD_REPEATS)}${index}`],
    label: `Command ${index}`,
    enabled: true,
  }));
  expect(() => serializeMenuInspection({ ...REPORT, menus })).toThrow("capacity_menu:");
});
