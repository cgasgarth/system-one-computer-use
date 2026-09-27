import { expect, test } from "bun:test";
import type { Window } from "../src/agent/contracts.ts";
import { enterText } from "../src/agent/input.ts";
import type { ManagedComputer } from "../src/computer/types.ts";
import { computerFixture, desktopFixture, expectFailure, windowFixture } from "./fixtures.ts";

const ROW_HEIGHT = 40;
function rowWindow(names: readonly string[], snapshot: string): Window {
  const elements: Window["elements"][number][] = [];
  let index = 0;
  for (const [position, name] of names.entries()) {
    const rowIndex = index;
    index += 1;
    const fieldIndex = index;
    index += 1;
    elements.push(
      {
        element_index: rowIndex,
        element_token: `row:${name}:${snapshot}`,
        role: "row",
        label: name,
      },
      {
        element_index: fieldIndex,
        parent_index: rowIndex,
        element_token: `field:${name}:${snapshot}`,
        role: "textbox",
        label: "Name",
        value: "",
        editable: true,
        frame: { x: 10, y: position * ROW_HEIGHT, w: 120, h: 24 },
      },
    );
  }
  return { ...windowFixture(), snapshot_id: snapshot, elements };
}
function rowInput(
  initial: Window,
  afterGeneration: Window,
): {
  readonly typed: readonly string[];
  readonly containers: readonly string[];
  readonly run: () => ReturnType<typeof enterText>;
} {
  const { computer } = computerFixture();
  const typed: string[] = [];
  const containers: string[] = [];
  let current = initial;
  const bound: ManagedComputer = {
    ...computer,
    async window() {
      return current;
    },
    async typeText(action) {
      typed.push(action.element_token);
      const elements: Window["elements"][number][] = [];
      for (const element of current.elements) {
        elements.push(
          element.element_token === action.element_token
            ? { ...element, value: action.text }
            : element,
        );
      }
      current = { ...current, elements };
    },
  };
  return {
    typed,
    containers,
    run: async () =>
      enterText({
        action: {
          kind: "compose_text",
          pid: initial.pid,
          window_id: initial.window_id,
          element_token: "field:Roadmap:initial",
          reason: "Enter Name in Roadmap row",
        },
        observation: { desktop: desktopFixture(), window: initial },
        computer: bound,
        options: {
          task: "Set the Roadmap Name to Alex",
          applications: [],
          computer: () => bound,
          text: {
            async generate(input) {
              containers.push(input.field?.container ?? "");
              current = afterGeneration;
              return "Alex";
            },
          },
          decision: {
            async choose() {
              throw new Error("No decision needed");
            },
          },
        },
      }),
  };
}

test("writes the same named row after rows reorder and its token and frame change", async () => {
  const fixture = rowInput(
    rowWindow(["Roadmap", "Release"], "initial"),
    rowWindow(["Release", "Roadmap"], "fresh"),
  );
  const result = await fixture.run();
  expect(fixture.containers).toEqual(['row "Roadmap"']);
  expect(fixture.typed).toEqual(["field:Roadmap:fresh"]);
  expect(result.verifiedField?.value).toBe("Alex");
});

test("rejects the other row even when it moves into the selected field frame", async () => {
  const fixture = rowInput(
    rowWindow(["Roadmap", "Release"], "initial"),
    rowWindow(["Release"], "fresh"),
  );
  await expectFailure(fixture.run(), "selected input changed");
  expect(fixture.typed).toEqual([]);
});

test("writes the same container after only the field token changes", async () => {
  const fixture = rowInput(rowWindow(["Roadmap"], "initial"), rowWindow(["Roadmap"], "fresh"));
  await fixture.run();
  expect(fixture.typed).toEqual(["field:Roadmap:fresh"]);
});
