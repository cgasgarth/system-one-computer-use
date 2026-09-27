import { expect, test } from "bun:test";
import { actionDescription } from "../src/models/decision-context.ts";
import { targetContainerContext } from "../src/agent/target-context.ts";
import type { Window } from "../src/agent/contracts.ts";
import { desktopFixture, windowFixture } from "./fixtures.ts";

const LABEL_DISPLAY_LIMIT = 100;

test("distinguishes duplicate Save controls by their observed containers", () => {
  const window: Window = {
    ...windowFixture(),
    window_title: "Documents",
    elements: [
      { element_index: 1, element_token: "row-one", role: "row", label: "Roadmap" },
      {
        element_index: 2,
        parent_index: 1,
        element_token: "save-one",
        role: "button",
        label: "Save",
        actions: ["AXPress"],
      },
      { element_index: 3, element_token: "row-two", role: "row", label: "Release" },
      {
        element_index: 4,
        parent_index: 3,
        element_token: "save-two",
        role: "button",
        label: "Save",
        actions: ["AXPress"],
      },
      { element_index: 5, element_token: "row-three", role: "row" },
      {
        element_index: 6,
        parent_index: 5,
        element_token: "row-heading",
        role: "heading",
        label: "Audit",
      },
      {
        element_index: 7,
        parent_index: 5,
        element_token: "save-three",
        role: "button",
        label: "Save",
        actions: ["AXPress"],
      },
    ],
  };
  const observation = { desktop: desktopFixture(), window };
  const describe = (element_token: string): string =>
    actionDescription(
      {
        kind: "click_element",
        pid: window.pid,
        window_id: window.window_id,
        element_token,
        reason: "Save",
      },
      observation,
    );
  const roadmap = describe("save-one");
  const release = describe("save-two");
  const audit = describe("save-three");
  expect(roadmap).toContain('row "Roadmap"');
  expect(release).toContain('row "Release"');
  expect(audit).toContain('row "Audit"');
  const descriptions = [roadmap, release, audit];
  expect(new Set(descriptions).size).toBe(descriptions.length);
});

test("field identity keeps the full observed row name when display text is shortened", () => {
  const shared = "A".repeat(LABEL_DISPLAY_LIMIT);
  const window: Window = {
    ...windowFixture(),
    elements: [
      { element_index: 1, element_token: "first-row", role: "row", label: `${shared} first` },
      { element_index: 2, parent_index: 1, element_token: "first", role: "textbox", label: "Name" },
      { element_index: 3, element_token: "second-row", role: "row", label: `${shared} second` },
      {
        element_index: 4,
        parent_index: 3,
        element_token: "second",
        role: "textbox",
        label: "Name",
      },
    ],
  };
  const [firstRow, first, secondRow, second] = window.elements;
  if (
    firstRow === undefined ||
    first === undefined ||
    secondRow === undefined ||
    second === undefined
  ) {
    throw new Error("Missing test controls");
  }
  expect(targetContainerContext(first, window)).not.toBe(targetContainerContext(second, window));
});

test("an unlabeled container with two headings gives neither Save control a false owner", () => {
  const window: Window = {
    ...windowFixture(),
    elements: [
      { element_index: 0, element_token: "group", role: "group" },
      {
        element_index: 1,
        parent_index: 0,
        element_token: "heading-one",
        role: "heading",
        label: "Roadmap",
      },
      {
        element_index: 2,
        parent_index: 0,
        element_token: "heading-two",
        role: "heading",
        label: "Release",
      },
      {
        element_index: 3,
        parent_index: 0,
        element_token: "save-one",
        role: "button",
        label: "Save",
      },
      {
        element_index: 4,
        parent_index: 0,
        element_token: "save-two",
        role: "button",
        label: "Save",
      },
    ],
  };
  const first = window.elements.find((element) => element.element_token === "save-one");
  const second = window.elements.find((element) => element.element_token === "save-two");
  if (first === undefined || second === undefined) {
    throw new Error("Missing Save controls");
  }
  expect(targetContainerContext(first, window)).toBeUndefined();
  expect(targetContainerContext(second, window)).toBeUndefined();
  const observation = { desktop: desktopFixture(), window };
  for (const target of [first, second]) {
    const description = actionDescription(
      {
        kind: "click_element",
        pid: window.pid,
        window_id: window.window_id,
        element_token: target.element_token,
        reason: "Save",
      },
      observation,
    );
    expect(description).not.toContain("Roadmap");
    expect(description).not.toContain("Release");
  }
});
