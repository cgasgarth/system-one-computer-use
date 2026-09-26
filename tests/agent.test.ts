import { expect, test } from "bun:test";
import type { Action } from "../src/agent/contracts.ts";
import { isEditableElement, validateActions } from "../src/agent/contracts.ts";
import { runTask } from "../src/agent/loop.ts";
import type { Decision, DecisionInput } from "../src/models/system-one.ts";
import type { ManagedComputer } from "../src/computer/types.ts";
import { options } from "../src/agent/options.ts";
import {
  computerFixture,
  desktopFixture,
  expectFailure,
  textFixture,
  windowFixture,
} from "./fixtures.ts";

function pick(
  input: DecisionInput,
  kind: Action["kind"],
  surface?: "browser" | "desktop",
): Decision {
  const action = input.actions.find(
    (candidate) =>
      candidate.kind === kind &&
      (candidate.kind !== "select_surface" || candidate.surface === surface),
  );
  if (action === undefined) {
    throw new Error(`Missing ${kind}`);
  }
  return { action, latencyMs: 1, probabilities: { A0: 1 } };
}
test("offers both surfaces and terminal choices before opening a browser", () => {
  const choices = options({
    mode: undefined,
    observation: { desktop: desktopFixture() },
    applications: [],
  });
  expect(choices.map((action) => action.kind)).toEqual([
    "select_surface",
    "select_surface",
    "finish",
    "blocked",
  ]);
});
test("keeps switching and terminal actions available on every surface", () => {
  for (const mode of ["browser", "desktop"] as const) {
    const choices = options({
      mode,
      observation: { desktop: desktopFixture(), window: windowFixture() },
      applications: [],
    });
    expect(
      choices.some((action) => action.kind === "select_surface" && action.surface !== mode),
    ).toBe(true);
    expect(choices.some((action) => action.kind === "blocked")).toBe(true);
    expect(choices.some((action) => action.kind === "finish")).toBe(true);
  }
});
test("lets the decision model select desktop and invokes the writer only for an input", async () => {
  const { computer, typed } = computerFixture();
  let writes = 0;
  const result = await runTask({
    task: "Read my recent messages from Alex",
    applications: ["Messages"],
    computer(mode) {
      expect(mode).toBe("desktop");
      return computer;
    },
    text: {
      async generate(input) {
        if (input.purpose === "application") {
          return "Messages";
        }
        writes += 1;
        return "Alex";
      },
    },
    decision: {
      async choose(input) {
        if (!input.observation.window) {
          if (input.actions.some((action) => action.kind === "observe_window")) {
            return pick(input, "observe_window");
          }
          return pick(input, "select_surface", "desktop");
        }
        return typed.length === 0 ? pick(input, "compose_text") : pick(input, "finish");
      },
    },
  });
  expect(result.status).toBe("complete");
  expect(writes).toBe(1);
  expect(typed).toEqual(["Alex"]);
});
test("returns a tool failure to the model so it can change surfaces", async () => {
  const { computer } = computerFixture();
  let browserChosen = false;
  let switched = false;
  const browser: ManagedComputer = {
    ...computer,
    async window() {
      throw new Error("Browser access unavailable");
    },
  };
  const result = await runTask({
    task: "Use another surface if needed",
    applications: [],
    computer: (mode): ManagedComputer => (mode === "browser" ? browser : computer),
    text: textFixture(),
    decision: {
      async choose(input) {
        if (!browserChosen) {
          browserChosen = true;
          return pick(input, "select_surface", "browser");
        }
        if (!switched) {
          expect(input.feedback).toContain("Browser access unavailable");
          switched = true;
          return pick(input, "select_surface", "desktop");
        }
        return pick(input, "blocked");
      },
    },
  });
  expect(switched).toBe(true);
  expect(result.status).toBe("blocked");
});
test("validates element targets against the fresh snapshot", () => {
  const action: Action = {
    kind: "compose_text",
    pid: 7,
    window_id: 9,
    element_token: "stale",
    reason: "Enter text",
  };
  expect(validateActions([action], { desktop: desktopFixture(), window: windowFixture() })).toEqual(
    [],
  );
});

test("requires writable capability for native text areas", () => {
  const area = {
    element_index: 1,
    element_token: "s1:1",
    role: "AXTextArea",
    label: "Displayed message",
    actions: ["AXPress", "AXShowMenu"],
  };
  expect(isEditableElement(area)).toBe(false);
  expect(isEditableElement({ ...area, actions: ["AXSetValue"] })).toBe(true);
  expect(isEditableElement({ ...area, role: "AXTextField", label: "Search" })).toBe(true);
});

test("offers file controls for activation and editable controls for both typing and clicking", () => {
  const window = windowFixture();
  const observation = {
    desktop: desktopFixture(),
    window: {
      ...window,
      elements: [
        ...window.elements,
        {
          element_index: 2,
          element_token: "s1:2",
          role: "AXTextField",
          value: "photo.png",
          actions: ["AXOpen", "AXConfirm"],
        },
      ],
    },
  };
  const actions = options({ mode: "desktop", observation, applications: [] });
  expect(
    actions.some((action) => action.kind === "click_element" && action.element_token === "s1:2"),
  ).toBe(true);
  expect(
    actions.some((action) => action.kind === "compose_text" && action.element_token === "s1:2"),
  ).toBe(false);
  for (const kind of ["click_element", "compose_text"]) {
    expect(
      actions.some(
        (action) =>
          action.kind === kind && "element_token" in action && action.element_token === "s1:1",
      ),
    ).toBe(true);
  }
});

test("lets the model change tools when saved browser restoration fails", async () => {
  const { computer } = computerFixture();
  const browser: ManagedComputer = {
    ...computer,
    async restore() {
      throw new Error("Saved tab is unavailable");
    },
  };
  let switched = false;
  const result = await runTask({
    task: "Continue on the computer",
    applications: [],
    preferredSurface: "browser",
    previousSurface: { kind: "browser", url: "https://example.test", title: "Example" },
    computer: (mode): ManagedComputer => (mode === "browser" ? browser : computer),
    text: textFixture(),
    decision: {
      async choose(input) {
        if (!switched) {
          expect(input.feedback).toContain("Saved tab is unavailable");
          switched = true;
          return pick(input, "select_surface", "desktop");
        }
        return pick(input, "blocked");
      },
    },
  });
  expect(switched).toBe(true);
  expect(result.status).toBe("blocked");
});
test("Stop prevents a completed decision from starting its tool call", async () => {
  const { computer } = computerFixture();
  const stop = new AbortController();
  const accessed: string[] = [];
  const task = runTask({
    task: "Open a browser",
    applications: [],
    text: textFixture(),
    signal: stop.signal,
    computer(mode) {
      accessed.push(mode);
      return computer;
    },
    decision: {
      async choose(input) {
        stop.abort(new Error("Stopped"));
        return pick(input, "select_surface", "browser");
      },
    },
  });
  await expectFailure(task, "Stopped");
  expect(accessed).toEqual(["desktop"]);
});

test("explains a stop before any tool action without claiming a permission failure", async () => {
  const { computer } = computerFixture();
  const result = await runTask({
    task: "Unclear request",
    applications: ["Messages"],
    computer: () => computer,
    text: textFixture(),
    decision: {
      async choose(input) {
        return pick(input, "blocked");
      },
    },
  });
  expect(result.summary).toBe(
    "Stopped before taking an action. Review the task text or dictate it again, then select Start.",
  );
});

test("continues after verifying a field value without writing it again", async () => {
  const { computer, typed } = computerFixture();
  let decisions = 0;
  const result = await runTask({
    task: "Fill the search field with Alex",
    preferredSurface: "browser",
    applications: [],
    computer: () => computer,
    text: textFixture(),
    decision: {
      async choose(input) {
        decisions += 1;
        return pick(input, decisions === 1 ? "compose_text" : "finish");
      },
    },
  });
  expect(typed).toEqual(["Alex"]);
  expect(result.steps[0]?.performedAction).toBe(true);
  expect(result.steps[1]?.performedAction).not.toBe(true);
  expect(result.status).toBe("complete");
});
