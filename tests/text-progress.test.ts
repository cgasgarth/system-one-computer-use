import { expect, test } from "bun:test";
import { Progress } from "../src/agent/progress.ts";
import { textFieldKey } from "../src/agent/state-key.ts";
import type { ActionChoices } from "../src/agent/contracts.ts";
import { desktopFixture, windowFixture } from "./fixtures.ts";

test("keeps verified text satisfied across new handles and permits input after a value change", () => {
  const window = windowFixture();
  const [element] = window.elements;
  if (element === undefined) {
    throw new Error("Missing fixture input");
  }
  const observation = {
    desktop: desktopFixture(),
    window: { ...window, elements: [{ ...element, value: "hello" }] },
  };
  const progress = new Progress();
  progress.record(undefined, textFieldKey(observation, element.element_token));
  const fresh = {
    ...observation,
    window: {
      ...observation.window,
      elements: [{ ...element, value: "hello", element_token: "fresh" }],
    },
  };
  const actions: ActionChoices = [
    {
      kind: "compose_text",
      pid: window.pid,
      window_id: window.window_id,
      element_token: "fresh",
      reason: "Write message",
    },
    { kind: "finish", reason: "Complete", summary: "Done" },
  ];
  expect(progress.choices(actions, fresh).map((action) => action.kind)).toEqual(["finish"]);
  const cleared = {
    ...fresh,
    window: { ...fresh.window, elements: [{ ...element, value: "", element_token: "fresh" }] },
  };
  expect(progress.choices(actions, cleared).map((action) => action.kind)).toEqual([
    "compose_text",
    "finish",
  ]);
});
