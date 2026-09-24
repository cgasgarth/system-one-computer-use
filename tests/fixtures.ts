import { expect } from "bun:test";
import { z } from "zod";
import type { Desktop, TaskPlan, Window } from "../src/agent/contracts.ts";
import type { Computer } from "../src/computer/types.ts";
import type { DecisionModel } from "../src/models/system-one.ts";
import type { TextModel } from "../src/models/text.ts";

type Scene = "settings" | "setting-stuck" | "browser" | "pending";
interface Fixture {
  readonly clicked: readonly string[];
  readonly computer: Computer;
  readonly navigated: readonly string[];
}
const errorSchema = z.instanceof(Error);

function desktopFixture(): Desktop {
  return {
    apps: [{ bundle_id: "test.settings", name: "Settings", pid: 7 }],
    windows: [{ app_name: "Settings", pid: 7, title: "Settings", window_id: 9 }],
  };
}

function windowFixture(): Window {
  return {
    app_name: "Settings",
    elements: [
      {
        actions: ["AXPress"],
        element_index: 1,
        element_token: "s00000001:1",
        label: "Bluetooth",
        role: "AXButton",
      },
    ],
    pid: 7,
    snapshot_id: "s00000001",
    window_id: 9,
    window_title: "Settings",
  };
}

function sceneWindow(
  scene: Scene,
  clicked: readonly string[],
  navigated: readonly string[],
): Window {
  const window = windowFixture();
  if (scene === "setting-stuck") {
    return { ...window, window_title: "Sharing" };
  }
  if (scene === "settings") {
    return { ...window, elements: clicked.length === 0 ? window.elements : [] };
  }
  if (navigated.length === 0) {
    return { ...window, elements: [], window_title: "about:blank" };
  }
  const elements: Window["elements"] =
    scene === "pending"
      ? [
          {
            actions: [],
            element_index: 1,
            element_token: "p1:1",
            label: "Task pending",
            role: "status",
          },
        ]
      : [
          {
            actions: ["AXPress"],
            element_index: 1,
            element_token: "p1:more",
            label: "Learn more",
            role: "link",
          },
        ];
  return { ...window, elements, url: "https://example.com/", window_title: "https://example.com/" };
}

function computerFixture(scene: Scene): Fixture {
  const clicked: string[] = [];
  const navigated: string[] = [];
  const computer: Computer = {
    async clickElement(action) {
      clicked.push(action.element_token);
    },
    async desktop() {
      return desktopFixture();
    },
    async launchApp() {
      throw new Error("Unexpected launch");
    },
    async navigate(url) {
      navigated.push(url);
    },
    async pressKey() {
      throw new Error("Unexpected key");
    },
    async typeText() {
      throw new Error("Unexpected text");
    },
    async window() {
      return sceneWindow(scene, clicked, navigated);
    },
  };
  return { clicked, computer, navigated };
}

function textFixture(plan: TaskPlan): TextModel {
  return {
    async prepare() {
      return plan;
    },
  };
}

function decisionFixture(): DecisionModel {
  return {
    async choose(_task, _observation, actions) {
      return { action: actions[0], latencyMs: 1, probabilities: { A0: 1 } };
    },
  };
}

async function expectFailure<Result>(promise: Promise<Result>, message: string): Promise<void> {
  try {
    await promise;
  } catch (error) {
    expect(errorSchema.parse(error).message).toContain(message);
    return;
  }
  throw new Error("Expected a rejection");
}

export {
  computerFixture,
  decisionFixture,
  desktopFixture,
  expectFailure,
  textFixture,
  windowFixture,
};
