import type { Action } from "../src/agent/contracts.ts";
import { expect, test } from "bun:test";
import { Progress } from "../src/agent/progress.ts";
import { options } from "../src/agent/options.ts";
import { runTask } from "../src/agent/loop.ts";
import type { Decision, DecisionInput } from "../src/models/system-one.ts";
import type { ManagedComputer } from "../src/computer/types.ts";
import { computerFixture, desktopFixture, windowFixture } from "./fixtures.ts";

const DESTINATION = "https://example.test/destination";
const SAME_ARGUMENT_ATTEMPTS = 2;
function choose(input: DecisionInput, kind: "request_url" | "finish"): Decision {
  const action = input.actions.find((candidate) => candidate.kind === kind);
  if (action === undefined) {
    throw new Error(`Missing ${kind}`);
  }
  return { action, latencyMs: 1, probabilities: { A0: 1 } };
}
test("navigates once, reports an already reached URL, and offers another decision", async () => {
  const { computer: base } = computerFixture();
  const navigations: string[] = [];
  let url = "https://example.test/start";
  let argumentsGenerated = 0;
  const computer: ManagedComputer = {
    ...base,
    async window() {
      return { ...windowFixture(), url };
    },
    async navigate(target) {
      navigations.push(target);
      url = target;
    },
  };
  const result = await runTask({
    task: "Open the destination",
    preferredSurface: "browser",
    applications: [],
    computer: (): ManagedComputer => computer,
    text: {
      async generate(input) {
        argumentsGenerated += 1;
        if (argumentsGenerated === SAME_ARGUMENT_ATTEMPTS) {
          expect(input.recentResults).toContain(`Opened ${DESTINATION}`);
        }
        return DESTINATION;
      },
    },
    decision: {
      async choose(input) {
        if (argumentsGenerated < SAME_ARGUMENT_ATTEMPTS) {
          return choose(input, "request_url");
        }
        expect(input.actions.find((action) => action.kind === "request_url")?.reason).toContain(
          "different website",
        );
        expect(input.actions.some((action) => action.kind === "select_surface")).toBe(true);
        expect(input.feedback).toContain("repeating that navigation has no effect");
        return choose(input, "finish");
      },
    },
  });
  expect(navigations).toEqual([DESTINATION]);
  expect(result.steps[1]?.unchanged).toEqual({ kind: "url", url: DESTINATION });
  expect(result.status).toBe("complete");
});
test("restores navigation after the browser leaves a blocked destination", () => {
  const progress = new Progress();
  progress.record({ kind: "url", url: DESTINATION });
  const atDestination = {
    desktop: desktopFixture(),
    window: { ...windowFixture(), url: DESTINATION },
  };
  const elsewhere = {
    ...atDestination,
    window: { ...atDestination.window, url: "https://example.test/elsewhere" },
  };
  const actions = options({ mode: "browser", observation: atDestination, applications: [] });
  expect(
    progress.choices(actions, atDestination).find((action) => action.kind === "request_url")
      ?.reason,
  ).toContain("different website");
  expect(progress.choices(actions, elsewhere).some((action) => action.kind === "request_url")).toBe(
    true,
  );
  for (const kind of ["finish", "blocked", "select_surface"]) {
    expect(progress.choices(actions, atDestination).some((action) => action.kind === kind)).toBe(
      true,
    );
  }
});
test("keeps native controls available when reopening the same app has no effect", () => {
  const progress = new Progress();
  const observation = { desktop: desktopFixture(), window: windowFixture() };
  progress.record({ kind: "application", name: observation.window.app_name });
  const choices = progress.choices(
    options({ mode: "desktop", observation, applications: [] }),
    observation,
  );
  expect(choices.find((action) => action.kind === "request_app")?.reason).toContain(
    "another installed application",
  );
  expect(choices.some((action) => action.kind === "compose_text")).toBe(true);
  expect(choices.some((action) => action.kind === "select_surface")).toBe(true);
});

test("blocks repeated control actions across snapshot handles until visible state changes", () => {
  const progress = new Progress();
  const window = {
    ...windowFixture(),
    elements: [
      {
        element_index: 0,
        element_token: "s1:0",
        role: "button",
        label: "Search",
        actions: ["AXPress"],
      },
    ],
  };
  const initial = { desktop: desktopFixture(), window };
  const click = {
    kind: "click_element",
    pid: window.pid,
    window_id: window.window_id,
    element_token: "s1:0",
    reason: "Search",
  } as const;
  progress.observe(initial);
  progress.attempted(click, initial);
  const fresh = {
    ...initial,
    window: {
      ...window,
      snapshot_id: "s2",
      elements: [
        {
          ...window.elements[0],
          element_index: 0,
          element_token: "s2:0",
          role: "button",
          label: "Search",
          actions: ["AXPress"],
        },
      ],
    },
  };
  progress.observe(fresh);
  progress.attempted({ ...click, element_token: "s2:0" }, fresh);
  progress.observe(fresh);
  const actions = options({ mode: "browser", observation: fresh, applications: [] });
  expect(progress.choices(actions, fresh).some((action) => action.kind === "click_element")).toBe(
    false,
  );
  expect(progress.choices(actions, fresh).some((action) => action.kind === "select_surface")).toBe(
    true,
  );
  const changed = { ...fresh, window: { ...fresh.window, window_title: "Search results" } };
  progress.observe(changed);
  expect(progress.choices(actions, changed).some((action) => action.kind === "click_element")).toBe(
    true,
  );
});

test("keeps no-window app progress when another application's title changes", () => {
  const progress = new Progress();
  const app = { pid: 1, name: "Image Viewer" };
  const observation = { desktop: desktopFixture(), application: app };
  progress.observe(observation);
  progress.record({ kind: "application", name: app.name });
  const changed = { ...observation, desktop: { ...observation.desktop, windows: [] } };
  progress.observe(changed);
  const actions = options({ mode: "desktop", observation: changed, applications: [] });
  expect(
    progress.choices(actions, changed).find((action) => action.kind === "request_app")?.reason,
  ).toContain("reopening it has no effect");
});

test("stops retrying the same observation failure and restores refresh after recovery", () => {
  const progress = new Progress();
  const observation = { desktop: desktopFixture() };
  const actions = options({
    mode: "desktop",
    observation,
    observationFailed: true,
    applications: [],
  });
  progress.observeFailure("Window is unavailable");
  expect(progress.choices(actions, observation).some((action) => action.kind === "refresh")).toBe(
    true,
  );
  progress.observeFailure("Window is unavailable");
  const recovery = progress.choices(actions, observation);
  expect(recovery.some((action) => action.kind === "refresh")).toBe(false);
  for (const kind of ["select_surface", "finish", "blocked"]) {
    expect(recovery.some((action) => action.kind === kind)).toBe(true);
  }
  progress.observe(observation);
  expect(progress.choices(actions, observation).some((action) => action.kind === "refresh")).toBe(
    true,
  );
});

test("detects a repeated focus cycle across two different states", () => {
  const progress = new Progress();
  const first = { desktop: desktopFixture(), window: windowFixture() };
  const second = {
    ...first,
    window: {
      ...first.window,
      elements: first.window.elements.map((element) => ({ ...element, focused: true })),
    },
  };
  const tab = {
    kind: "press_key",
    key: "tab",
    modifiers: [],
    pid: first.window.pid,
    window_id: first.window.window_id,
    reason: "Press Tab",
  } as const;
  for (const observation of [first, second, first, second]) {
    progress.observe(observation);
    progress.attempted(tab, observation);
  }
  progress.observe(first);
  const actions = options({ mode: "desktop", observation: first, applications: [] });
  const available = progress.choices(actions, first);
  expect(available.some((action) => action.kind === "press_key" && action.key === "tab")).toBe(
    false,
  );
  expect(available.some((action) => action.kind === "compose_text")).toBe(true);
  expect(available.some((action) => action.kind === "select_surface")).toBe(true);
});

test("offers other tools after repeated app-launch failures in an unchanged desktop", () => {
  const progress = new Progress();
  const observation = { desktop: desktopFixture() };
  const action = {
    kind: "request_app",
    reason: "Open an installed application on this Mac.",
  } as const;
  progress.observe(observation);
  progress.attempted(action, observation);
  progress.attempted(action, observation);
  const choices = progress.choices(
    options({ mode: "desktop", observation, applications: ["Messages"] }),
    observation,
  );
  expect(choices.some((candidate) => candidate.kind === "request_app")).toBe(false);
  expect(choices.some((candidate) => candidate.kind === "observe_window")).toBe(true);
  expect(choices.some((candidate) => candidate.kind === "select_surface")).toBe(true);
  expect(choices.some((candidate) => candidate.kind === "blocked")).toBe(true);
  const changed = { desktop: { apps: observation.desktop.apps, windows: [] } };
  progress.observe(changed);
  expect(
    progress
      .choices(
        options({ mode: "desktop", observation: changed, applications: ["Messages"] }),
        changed,
      )
      .some((candidate) => candidate.kind === "request_app"),
  ).toBe(true);
});

test("offers recovery after repeated failed switches on the same screen", () => {
  const progress = new Progress();
  const observation = { desktop: desktopFixture(), window: windowFixture() };
  const change: Action = {
    kind: "select_surface",
    surface: "browser",
    reason: "Use browser tools",
  };
  progress.observe(observation);
  progress.attempted(change, observation);
  progress.attempted(change, observation);
  const recovery: Action = { kind: "blocked", reason: "Need browser access" };
  expect(progress.choices([change, recovery], observation)).toEqual([recovery]);
});
