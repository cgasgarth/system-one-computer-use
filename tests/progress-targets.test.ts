import { expect, test } from "bun:test";
import { Progress } from "../src/agent/progress.ts";
import { actionKey, textFieldKey } from "../src/agent/state-key.ts";
import type { Action, ActionChoices, Window } from "../src/agent/contracts.ts";
import { desktopFixture, windowFixture } from "./fixtures.ts";

const REDIRECT_TARGET = "https://example.test/target";
const NEXT_ROW_CONTROLS = 2;
function rows(names: readonly string[], snapshot: string): Window {
  const elements: Window["elements"][number][] = [];
  let index = 0;
  for (const name of names) {
    const parent = index;
    index += 1;
    elements.push(
      { element_index: parent, element_token: `row:${name}:${snapshot}`, role: "row", label: name },
      {
        element_index: index,
        parent_index: parent,
        element_token: `field:${name}:${snapshot}`,
        role: "textbox",
        label: "Name",
        value: "Alex",
        editable: true,
      },
      {
        element_index: index + 1,
        parent_index: parent,
        element_token: `save:${name}:${snapshot}`,
        role: "button",
        label: "Save",
        actions: ["AXPress"],
      },
    );
    index += NEXT_ROW_CONTROLS;
  }
  return { ...windowFixture(), snapshot_id: snapshot, elements };
}
function textActions(window: Window): ActionChoices {
  return [
    {
      kind: "compose_text",
      pid: window.pid,
      window_id: window.window_id,
      element_token: "field:Release:fresh",
      reason: "Enter Release Name",
    },
    {
      kind: "compose_text",
      pid: window.pid,
      window_id: window.window_id,
      element_token: "field:Roadmap:fresh",
      reason: "Enter Roadmap Name",
    },
    { kind: "finish", reason: "Done", summary: "Done" },
  ];
}

test("satisfied text and click retry keys stay with named rows after reorder", () => {
  const before = { desktop: desktopFixture(), window: rows(["Roadmap", "Release"], "before") };
  const after = { desktop: desktopFixture(), window: rows(["Release", "Roadmap"], "fresh") };
  const roadmap = textFieldKey(before, "field:Roadmap:before");
  expect(roadmap).toBeDefined();
  expect(textFieldKey(after, "field:Roadmap:fresh")).toBe(roadmap);
  expect(textFieldKey(after, "field:Release:fresh")).not.toBe(roadmap);
  const progress = new Progress();
  progress.record(undefined, roadmap);
  const available = progress.choices(textActions(after.window), after);
  expect(
    available.some(
      (action) => action.kind === "compose_text" && action.element_token === "field:Roadmap:fresh",
    ),
  ).toBe(false);
  expect(
    available.some(
      (action) => action.kind === "compose_text" && action.element_token === "field:Release:fresh",
    ),
  ).toBe(true);
  const click = (token: string): Extract<Action, { kind: "click_element" }> => ({
    kind: "click_element" as const,
    pid: before.window.pid,
    window_id: before.window.window_id,
    element_token: token,
    reason: "Save",
  });
  expect(actionKey(click("save:Roadmap:before"), before)).toBe(
    actionKey(click("save:Roadmap:fresh"), after),
  );
  expect(actionKey(click("save:Release:fresh"), after)).not.toBe(
    actionKey(click("save:Roadmap:fresh"), after),
  );
});

test("ambiguous duplicate fields without a named container cannot inherit satisfaction", () => {
  const window: Window = {
    ...windowFixture(),
    elements: [
      {
        element_index: 1,
        element_token: "first",
        role: "textbox",
        label: "Name",
        value: "Alex",
        editable: true,
      },
      {
        element_index: 2,
        element_token: "second",
        role: "textbox",
        label: "Name",
        value: "Alex",
        editable: true,
      },
    ],
  };
  const observation = { desktop: desktopFixture(), window };
  expect(textFieldKey(observation, "first")).toBeUndefined();
  expect(textFieldKey(observation, "second")).toBeUndefined();
});

test("direct URL retry stops after redirects and same-target navigation is a no-op", () => {
  const progress = new Progress();
  const navigate = { kind: "navigate" as const, url: REDIRECT_TARGET, reason: "Open supplied URL" };
  const actions: ActionChoices = [
    navigate,
    { kind: "finish", reason: "Done", summary: "Done" },
    { kind: "blocked", reason: "Stop" },
  ];
  for (const url of ["https://example.test/redirect-one", "https://example.test/redirect-two"]) {
    const observation = { desktop: desktopFixture(), window: { ...windowFixture(), url } };
    progress.observe(observation);
    progress.advanced(navigate, true);
    progress.attempted(navigate, observation);
  }
  const redirected = {
    desktop: desktopFixture(),
    window: { ...windowFixture(), url: "https://example.test/redirect-three" },
  };
  progress.observe(redirected);
  expect(actionKey(navigate, redirected)).toBeDefined();
  expect(progress.choices(actions, redirected).some((action) => action.kind === "navigate")).toBe(
    false,
  );
  expect(progress.choices(actions, redirected).some((action) => action.kind === "finish")).toBe(
    true,
  );
  progress.advanced(
    {
      kind: "click_element",
      pid: redirected.window.pid,
      window_id: redirected.window.window_id,
      element_token: "control",
      reason: "Use control",
    },
    true,
  );
  expect(progress.choices(actions, redirected).some((action) => action.kind === "navigate")).toBe(
    true,
  );
  const atTarget = { ...redirected, window: { ...redirected.window, url: REDIRECT_TARGET } };
  expect(progress.choices(actions, atTarget).some((action) => action.kind === "navigate")).toBe(
    false,
  );
});
