import { expect, test } from "bun:test";
import { options } from "../src/agent/options.ts";
import { desktopFixture, windowFixture } from "./fixtures.ts";

function keys(window: ReturnType<typeof windowFixture>): string[] {
  return options({
    mode: "desktop",
    observation: { desktop: desktopFixture(), window },
    applications: [],
  }).flatMap((action) => (action.kind === "press_key" ? [action.key] : []));
}

test("offers Return for a focused search field despite another clickable control", () => {
  const window = {
    ...windowFixture(),
    elements: [
      {
        element_index: 1,
        element_token: "search",
        role: "AXTextField",
        subrole: "AXSearchField",
        label: "Search",
        value: "query",
        editable: true,
        focused: true,
        actions: ["AXSetValue"],
      },
      {
        element_index: 2,
        element_token: "submit",
        role: "AXButton",
        label: "Search now",
        actions: ["AXPress"],
      },
    ],
  };
  const actions = options({
    mode: "desktop",
    observation: { desktop: desktopFixture(), window },
    applications: [],
  });
  const press = actions.find((action) => action.kind === "press_key" && action.key === "return");
  expect(press).toMatchObject({ element_token: "search", key: "return" });
  expect(keys(window)).toEqual(["return", "tab"]);
});

test("directional keys require a focused choice control", () => {
  const window = {
    ...windowFixture(),
    elements: [
      {
        element_index: 1,
        element_token: "choice",
        role: "combobox",
        label: "Priority",
        value: "High",
        focused: true,
        actions: ["AXPick"],
      },
      {
        element_index: 2,
        element_token: "save",
        role: "button",
        label: "Save",
        actions: ["AXPress"],
      },
    ],
  };
  expect(keys(window)).toEqual(["return", "escape", "tab", "down", "up"]);
  expect(
    keys({
      ...window,
      elements: [
        {
          element_index: 1,
          element_token: "choice",
          role: "combobox",
          label: "Priority",
          value: "High",
          focused: false,
          actions: ["AXPick"],
        },
        {
          element_index: 2,
          element_token: "save",
          role: "button",
          label: "Save",
          actions: ["AXPress"],
        },
      ],
    }),
  ).toEqual([]);
});

test("ambiguous focus does not create keyboard actions", () => {
  const window = {
    ...windowFixture(),
    elements: [
      {
        element_index: 1,
        element_token: "a",
        role: "textbox",
        label: "First",
        editable: true,
        focused: true,
      },
      {
        element_index: 2,
        element_token: "b",
        role: "textbox",
        label: "Second",
        editable: true,
        focused: true,
      },
    ],
  };
  expect(keys(window)).toEqual([]);
});
