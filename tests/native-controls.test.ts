import { expect, test } from "bun:test";
import { options } from "../src/agent/options.ts";
import { relevantControls, textTargetName } from "../src/agent/controls.ts";
import { SurfaceSession } from "../src/agent/surface.ts";
import { computerFixture, desktopFixture, windowFixture } from "./fixtures.ts";

const MANY_ROWS = 200;
test("keeps the selected editor while offering other windows directly", async () => {
  const session = new SurfaceSession();
  const { computer } = computerFixture();
  const desktop = desktopFixture();
  const window = windowFixture();
  session.mode = "desktop";
  session.selectApplication(desktop.apps[0]);
  session.setTarget({ pid: window.pid, windowId: window.window_id });
  const first = await session.observe(() => computer);
  const second = await session.observe(() => computer);
  expect(second.window?.window_id).toBe(first.window?.window_id);
  const other = {
    app_name: "Other",
    title: "Other window",
    pid: window.pid + 1,
    window_id: window.window_id + 1,
  };
  const choices = options({
    mode: "desktop",
    applications: [],
    observation: { ...second, desktop: { ...desktop, windows: [...desktop.windows, other] } },
  });
  expect(
    choices.some(
      (action) => action.kind === "observe_window" && action.window_id === other.window_id,
    ),
  ).toBe(true);
  expect(choices.some((action) => action.kind === "compose_text")).toBe(true);
});

test("keeps editable content visible ahead of a long list of structural rows", () => {
  const editor = {
    element_index: MANY_ROWS,
    element_token: "editor",
    role: "AXTextArea",
    label: "hello",
    value: "hello",
    editable: true,
  };
  const window = {
    ...windowFixture(),
    elements: [
      ...Array.from({ length: MANY_ROWS }, (_unused, index) => ({
        element_index: index,
        element_token: String(index),
        role: "AXRow",
        actions: ["AXShowMenu"],
      })),
      editor,
    ],
  };
  expect(relevantControls(window)[0]).toBe(editor);
  expect(textTargetName(editor)).toBe("document editor");
  const choices = options({
    mode: "desktop",
    applications: [],
    observation: { desktop: desktopFixture(), window },
  });
  expect(
    choices.some((action) => action.kind === "compose_text" && action.element_token === "editor"),
  ).toBe(true);
});

test("uses the active dialog subtree instead of controls behind it", async () => {
  const { activeWindowElements } = await import("../src/computer/native-scope.ts");
  const frame = { x: 10, y: 10, w: 200, h: 100 };
  const window = {
    ...windowFixture(),
    elements: [
      { element_index: 0, element_token: "root", role: "AXWindow", frame },
      {
        element_index: 1,
        parent_index: 0,
        element_token: "behind",
        role: "AXButton",
        label: "New item",
        frame,
      },
      { element_index: 2, parent_index: 0, element_token: "dialog", role: "AXPopover", frame },
      { element_index: 3, parent_index: 2, element_token: "group", role: "AXGroup" },
      { element_index: 4, parent_index: 3, element_token: "field", role: "AXTextField", frame },
    ],
  };
  expect(activeWindowElements(window).map((element) => element.element_token)).toEqual([
    "root",
    "dialog",
    "group",
    "field",
  ]);
});

test("offers the exact confirm operation reported by a text control", () => {
  const window = {
    ...windowFixture(),
    elements: [
      {
        element_index: 0,
        element_token: "field",
        role: "AXTextField",
        label: "New item",
        value: "",
        actions: ["AXConfirm"],
      },
    ],
  };
  const choices = options({
    mode: "desktop",
    applications: [],
    observation: { desktop: desktopFixture(), window },
  });
  expect(choices).toContainEqual({
    kind: "click_element",
    operation: "confirm",
    pid: window.pid,
    window_id: window.window_id,
    element_token: "field",
    reason: "Submit text in New item",
  });
});

test("keeps the selected surface usable after its saved target cannot be restored", async () => {
  const session = new SurfaceSession();
  const { computer } = computerFixture();
  let restorations = 0;
  const browser = {
    ...computer,
    async restore(): Promise<never> {
      restorations += 1;
      throw new Error("Saved tab closed");
    },
  };
  const saved = { kind: "browser", url: "https://example.test/old", title: "Old" } as const;
  try {
    await session.select("browser", browser, saved);
  } catch {
    /* The next decision gets the restoration error. */
  }
  expect(session.mode).toBe("browser");
  const observed = await session.observe(() => browser);
  expect(observed.window).toBeDefined();
  await session.select("browser", browser, saved);
  expect(restorations).toBe(1);
});
