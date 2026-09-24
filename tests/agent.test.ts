import { expect, test } from "bun:test";
import { taskLooksComplete } from "../src/agent/completion.ts";
import { validateActions } from "../src/agent/contracts.ts";
import type { Action, ActionChoices, TaskPlan, Window } from "../src/agent/contracts.ts";
import { runTask } from "../src/agent/loop.ts";
import { initialProgress } from "../src/agent/progress.ts";
import { candidates } from "../src/agent/candidates.ts";
import {
  computerFixture,
  decisionFixture,
  desktopFixture,
  expectFailure,
  textFixture,
  windowFixture,
} from "./fixtures.ts";

const DELAYED_OBSERVATIONS = 3;

test("grounds an action in the current snapshot", () => {
  const actions: ActionChoices = [
    {
      element_token: "s00000001:1",
      kind: "click_element",
      pid: 7,
      reason: "Open Bluetooth",
      window_id: 9,
    },
    {
      element_token: "s00000000:1",
      kind: "click_element",
      pid: 7,
      reason: "Old snapshot",
      window_id: 9,
    },
  ];
  const actual = validateActions(actions, { desktop: desktopFixture(), window: windowFixture() });
  expect(actual).toEqual([actions[0]]);
});

test("requires the target window in the live desktop", () => {
  const action: Action = {
    kind: "observe_window",
    pid: 7,
    reason: "Invented target",
    window_id: 100,
  };
  expect(validateActions([action], { desktop: desktopFixture() })).toEqual([]);
});

test("requires an editable control for typing", () => {
  const window = {
    ...windowFixture(),
    elements: [
      {
        actions: ["AXPress"],
        element_index: 2,
        element_token: "s00000001:2",
        label: "Sharing",
        role: "AXStaticText",
      },
    ],
  };
  const action: Action = {
    element_token: "s00000001:2",
    kind: "type_text",
    pid: 7,
    reason: "Search settings",
    text: "Bluetooth",
    window_id: 9,
  };
  expect(validateActions([action], { desktop: desktopFixture(), window })).toEqual([]);
});

test("lets the decision model choose live computer actions", async () => {
  const fixture = computerFixture("settings");
  const result = await runTask({
    computer: fixture.computer,
    decision: decisionFixture(),
    task: "Open Bluetooth settings",
    text: textFixture({ app: "Settings", goal: "task", targetLabel: "Bluetooth" }),
  });
  expect(fixture.clicked).toEqual(["s00000001:1"]);
  expect(result.steps.map((step) => step.action.kind)).toEqual([
    "observe_window",
    "click_element",
    "finish",
  ]);
  expect(result.requestsPerSecond).toBeGreaterThan(0);
});

test("waits for a delayed UI result without repeating the click", async () => {
  const fixture = computerFixture("settings");
  let pendingReads = 0;
  const computer = {
    ...fixture.computer,
    async window(): Promise<Window> {
      if (fixture.clicked.length === 0) {
        return windowFixture();
      }
      pendingReads += 1;
      return {
        ...windowFixture(),
        elements: [],
        window_title: pendingReads < DELAYED_OBSERVATIONS ? "Loading" : "Bluetooth",
      };
    },
  };
  const result = await runTask({
    computer,
    decision: decisionFixture(),
    task: "Open Bluetooth settings",
    text: textFixture({ app: "Settings", goal: "task", targetLabel: "Bluetooth" }),
  });
  expect(fixture.clicked).toHaveLength(1);
  expect(result.steps.map((step) => step.action.kind)).toEqual([
    "observe_window",
    "click_element",
    "finish",
  ]);
  expect(pendingReads).toBe(DELAYED_OBSERVATIONS);
});

test("navigates the selected browser tab once", async () => {
  const fixture = computerFixture("browser");
  const result = await runTask({
    computer: fixture.computer,
    decision: decisionFixture(),
    task: "Open https://example.com",
    text: textFixture({ goal: "open_url", url: "https://example.com" }),
  });
  expect(fixture.navigated).toEqual(["https://example.com"]);
  expect(result.steps.map((step) => step.action.kind)).toEqual([
    "observe_window",
    "navigate",
    "finish",
  ]);
});

test("requires an observed result after a setting click", async () => {
  const fixture = computerFixture("setting-stuck");
  await expectFailure(
    runTask({
      computer: fixture.computer,
      decision: decisionFixture(),
      task: "Open Bluetooth settings",
      text: textFixture({ app: "Settings", goal: "task", targetLabel: "Bluetooth" }),
    }),
    "No usable control",
  );
});

test("keeps a pending browser task open after navigation", async () => {
  const fixture = computerFixture("pending");
  await expectFailure(
    runTask({
      computer: fixture.computer,
      decision: decisionFixture(),
      task: "Open https://example.com",
      text: textFixture({ goal: "task", url: "https://example.com" }),
    }),
    "No usable control",
  );
});

test("does not reuse the completion status of a previous task", () => {
  const window = {
    ...windowFixture(),
    elements: [
      {
        actions: [],
        element_index: 1,
        element_token: "p1:1",
        label: "Task complete",
        role: "status",
      },
    ],
  };
  expect(
    taskLooksComplete({ goal: "task" }, { desktop: desktopFixture(), window }, initialProgress()),
  ).toBe(false);
});

test("offers destination links for a website task and verifies arrival", () => {
  const plan = {
    goal: "open_website",
    website: "example books",
    url: "https://www.google.com/search?q=example+books",
  } satisfies TaskPlan;
  const progress = { ...initialProgress(), hasNavigated: true, hasActed: true };
  const window = {
    ...windowFixture(),
    url: plan.url,
    window_title: "example books - Google Search",
    elements: [
      {
        element_index: 0,
        element_token: "e1",
        role: "link",
        label: "Example Books",
        href: "https://books.example/",
        actions: ["AXPress"],
      },
      {
        element_index: 1,
        element_token: "e2",
        role: "link",
        label: "Example Books app",
        href: "https://www.google.com/search?q=app",
        actions: ["AXPress"],
      },
    ],
  };
  const observation = { desktop: desktopFixture(), window };
  const actions = candidates({
    canNavigate: true,
    observation,
    plan,
    progress,
    task: "go to example books",
  });
  expect(
    actions.map((action) => (action.kind === "click_element" ? action.element_token : action.kind)),
  ).toEqual(["e1"]);
  expect(taskLooksComplete(plan, observation, { ...progress, hasTaskAction: true })).toBe(false);
  expect(
    taskLooksComplete(
      plan,
      {
        ...observation,
        window: { ...window, url: "https://books.example/", window_title: "ExampleBooks" },
      },
      { ...progress, hasTaskAction: true },
    ),
  ).toBe(true);
});

test("typing completion requires typing into an editable field during this task", () => {
  const window = {
    ...windowFixture(),
    elements: [
      {
        element_index: 0,
        element_token: "e1",
        role: "textbox",
        label: "Location",
        value: "Chicago",
        actions: ["AXSetValue"],
      },
    ],
  };
  const observation = { desktop: desktopFixture(), window };
  const plan = { goal: "enter_text", textToEnter: "Chicago" } satisfies TaskPlan;
  const clicked = { ...initialProgress(), hasTaskAction: true, hasActed: true };
  expect(taskLooksComplete(plan, observation, clicked)).toBe(false);
  expect(
    taskLooksComplete(plan, observation, {
      ...clicked,
      textEntry: { text: "Chicago", label: "Other field" },
    }),
  ).toBe(false);
  expect(
    taskLooksComplete(plan, observation, {
      ...clicked,
      textEntry: { text: "Chicago", label: "Location" },
    }),
  ).toBe(true);
});

test("navigates to a planned destination before offering the previous page's controls", () => {
  const observation = { desktop: desktopFixture(), window: windowFixture() };
  const actions = candidates({
    canNavigate: true,
    observation,
    plan: { goal: "open_url", url: "https://example.com" },
    progress: initialProgress(),
    task: "Open https://example.com",
  });
  expect(actions.map((action) => action.kind)).toEqual(["navigate"]);
});

test("stop prevents execution of a decision that was still in flight", async () => {
  const fixture = computerFixture("settings");
  const controller = new AbortController();
  const decision = decisionFixture();
  await expectFailure(
    runTask({
      computer: fixture.computer,
      decision: {
        async choose(task, observation, actions) {
          const selected = await decision.choose(task, observation, actions);
          if (selected.action.kind === "click_element") {
            controller.abort(new Error("Stopped by user"));
          }
          return selected;
        },
      },
      text: textFixture({ goal: "task", app: "Settings", targetLabel: "Bluetooth" }),
      task: "Open Bluetooth settings",
      signal: controller.signal,
    }),
    "Stopped by user",
  );
  expect(fixture.clicked).toHaveLength(0);
});
