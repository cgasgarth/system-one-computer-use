import { expect, test } from "bun:test";
import type { Window } from "../src/agent/contracts.ts";
import type { TextModel } from "../src/models/text.ts";
import type { ActionResult } from "../src/agent/types.ts";
import type { ManagedComputer } from "../src/computer/types.ts";
import { enterText } from "../src/agent/input.ts";
import { textFieldKey } from "../src/agent/state-key.ts";
import { computerFixture, desktopFixture, expectFailure, windowFixture } from "./fixtures.ts";

function inputFixture(
  initial: Window,
  afterGeneration: Window,
): {
  readonly typed: readonly string[];
  readonly run: () => Promise<ActionResult>;
} {
  const { computer, typed } = computerFixture();
  let current = initial;
  const boundComputer: ManagedComputer = {
    ...computer,
    async window() {
      const elements: Window["elements"][number][] = [];
      for (const field of current.elements) {
        elements.push({ ...field, value: typed.at(-1) ?? field.value });
      }
      return {
        ...current,
        elements,
      };
    },
  };
  const text: TextModel = {
    async generate() {
      current = afterGeneration;
      return "Alex";
    },
  };
  return {
    typed,
    async run() {
      return enterText({
        action: {
          kind: "compose_text",
          pid: initial.pid,
          window_id: initial.window_id,
          element_token: "s1:1",
          reason: "Enter the requested text",
        },
        observation: { desktop: desktopFixture(), window: initial },
        computer: boundComputer,
        options: {
          task: "Find Alex",
          applications: [],
          computer: () => boundComputer,
          text,
          decision: {
            async choose() {
              throw new Error("The input executor does not make decisions");
            },
          },
        },
      });
    },
  };
}

test("rejects a same-labelled field on another URL after argument generation", async () => {
  const original = { ...windowFixture(), url: "https://example.test/document/one" };
  const fixture = inputFixture(original, { ...original, url: "https://example.test/document/two" });
  await expectFailure(fixture.run(), "document changed");
  expect(fixture.typed).toEqual([]);
});

test("rejects a different native document in the same window", async () => {
  const original = { ...windowFixture(), window_title: "Document one" };
  const fixture = inputFixture(original, { ...original, window_title: "Document two" });
  await expectFailure(fixture.run(), "document changed");
  expect(fixture.typed).toEqual([]);
});

test("accepts a fresh snapshot of the unchanged input document", async () => {
  const original = windowFixture();
  const elements: Window["elements"][number][] = [];
  for (const element of original.elements) {
    elements.push({ ...element, element_token: "fresh:1" });
  }
  const fixture = inputFixture(original, {
    ...original,
    snapshot_id: "fresh",
    elements,
  });
  const result = await fixture.run();
  expect(fixture.typed).toEqual(["Alex"]);
  expect(result.verifiedField?.value).toBe("Alex");
});

test("keeps satisfied inputs scoped to their document", () => {
  const window = windowFixture();
  const observation = { desktop: desktopFixture(), window };
  const key = textFieldKey(observation, "s1:1");
  expect(key).toBeDefined();
  expect(
    textFieldKey({ ...observation, window: { ...window, window_title: "Other" } }, "s1:1"),
  ).not.toBe(key);
  expect(
    textFieldKey({ ...observation, window: { ...window, url: "https://example.test" } }, "s1:1"),
  ).not.toBe(key);
});
