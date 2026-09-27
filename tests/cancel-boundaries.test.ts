import { expect, test } from "bun:test";
import { enterText, openApplication, openUrl } from "../src/agent/input.ts";
import { runTask } from "../src/agent/loop.ts";
import type { ManagedComputer } from "../src/computer/types.ts";
import { computerFixture, desktopFixture, expectFailure, windowFixture } from "./fixtures.ts";

function stopped(): Error {
  return new Error("Stopped before the tool action");
}

test("Stop during the fresh field read prevents text entry", async () => {
  const controller = new AbortController();
  const { computer: base, typed } = computerFixture();
  const window = windowFixture();
  const computer: ManagedComputer = {
    ...base,
    async window() {
      controller.abort(stopped());
      return window;
    },
  };
  await expectFailure(
    enterText({
      action: {
        kind: "compose_text",
        pid: window.pid,
        window_id: window.window_id,
        element_token: "s1:1",
        reason: "Enter search",
      },
      observation: { desktop: desktopFixture(), window },
      computer,
      options: {
        task: "Enter Alex",
        applications: [],
        signal: controller.signal,
        computer: () => computer,
        text: { generate: async () => "Alex" },
        decision: {
          choose: async () => {
            throw new Error("No decision needed");
          },
        },
      },
    }),
    "Stopped before the tool action",
  );
  expect(typed).toEqual([]);
});

test("Stop during the fresh browser read prevents URL navigation", async () => {
  const controller = new AbortController();
  const { computer: base } = computerFixture();
  let navigations = 0;
  const computer: ManagedComputer = {
    ...base,
    async window() {
      controller.abort(stopped());
      return { ...windowFixture(), url: "about:blank" };
    },
    async navigate() {
      navigations += 1;
    },
  };
  await expectFailure(
    openUrl({
      action: { kind: "request_url", reason: "Open URL" },
      observation: { desktop: desktopFixture(), window: windowFixture() },
      computer,
      options: {
        task: "Open a website",
        applications: [],
        signal: controller.signal,
        computer: () => computer,
        text: { generate: async () => "https://example.test/" },
        decision: {
          choose: async () => {
            throw new Error("No decision needed");
          },
        },
      },
    }),
    "Stopped before the tool action",
  );
  expect(navigations).toBe(0);
});

test("Stop during app discovery prevents launching it", async () => {
  const controller = new AbortController();
  const { computer: base } = computerFixture();
  let launches = 0;
  const computer: ManagedComputer = {
    ...base,
    async desktop() {
      controller.abort(stopped());
      return desktopFixture();
    },
    async launchApp() {
      launches += 1;
    },
  };
  await expectFailure(
    openApplication({
      action: { kind: "request_app", name: "Notes", reason: "Open Notes" },
      observation: { desktop: desktopFixture(), window: windowFixture() },
      computer,
      options: {
        task: "Open Notes",
        applications: ["Notes"],
        signal: controller.signal,
        computer: () => computer,
        text: { generate: async () => "" },
        decision: {
          choose: async () => {
            throw new Error("No decision needed");
          },
        },
      },
    }),
    "Stopped before the tool action",
  );
  expect(launches).toBe(0);
});

test("Stop during browser click freshness read prevents activation", async () => {
  const controller = new AbortController();
  const { computer: base } = computerFixture();
  let reads = 0;
  let clicks = 0;
  const window = {
    ...windowFixture(),
    app_name: "Google Chrome",
    pid: 0,
    window_id: 0,
    window_title: "Page",
    url: "https://example.test/",
    elements: [
      {
        element_index: 1,
        element_token: "button",
        role: "button",
        label: "Continue",
        actions: ["AXPress"],
      },
    ],
  };
  const browser: ManagedComputer = {
    ...base,
    async desktop() {
      return {
        apps: [{ name: "Google Chrome", pid: 0 }],
        windows: [{ app_name: "Google Chrome", pid: 0, window_id: 0, title: "Page" }],
      };
    },
    async window() {
      reads += 1;
      if (reads > 1) {
        controller.abort(stopped());
      }
      return window;
    },
    async clickElement() {
      clicks += 1;
    },
  };
  await expectFailure(
    runTask({
      task: "Activate Continue",
      preferredSurface: "browser",
      applications: [],
      signal: controller.signal,
      computer: () => browser,
      text: { generate: async () => "" },
      decision: {
        async choose(input) {
          const action = input.actions.find((candidate) => candidate.kind === "click_element");
          if (action === undefined) {
            throw new Error("Missing button");
          }
          return { action, latencyMs: 1, probabilities: { A0: 1 } };
        },
      },
    }),
    "Stopped before the tool action",
  );
  expect(clicks).toBe(0);
});
