import { expect, test } from "bun:test";
import type { TaskPlan } from "../src/agent/contracts.ts";
import { taskDesktop } from "../src/computer/targets.ts";
import { parseSnapshot, snapshotElements } from "../src/computer/playwright/snapshot.ts";
import { candidates } from "../src/agent/candidates.ts";
import { initialProgress } from "../src/agent/progress.ts";
import { settingsSchema } from "../src/app/settings-schema.ts";
import { isConnectionPage, parseTabs } from "../src/computer/playwright/tabs.ts";
import { resolveMode } from "../src/app/config.ts";
import { textFixture } from "./fixtures.ts";

test("exposes only user application windows to the task loop", () => {
  const desktop = taskDesktop({
    apps: [
      { name: "Cua Driver", bundle_id: "com.trycua.driver", pid: 1 },
      { name: "Calculator", pid: 2 },
    ],
    windows: [
      { app_name: "Cua Driver", pid: 1, window_id: 1, title: "Authorization" },
      { app_name: "Calculator", pid: 2, window_id: 2, title: "Calculator" },
    ],
  });
  expect(desktop.windows.map((window) => window.app_name)).toEqual(["Calculator"]);
  expect(desktop.apps.map((app) => app.name)).toEqual(["Calculator"]);
});

test("keeps named-app tasks inside the requested application", () => {
  const actions = candidates({
    canNavigate: false,
    observation: {
      desktop: {
        apps: [],
        windows: [{ app_name: "Handy", pid: 1, window_id: 1, title: "Handy" }],
      },
    },
    plan: { goal: "open_app", app: "Calculator" },
    progress: initialProgress(),
    task: "Open Calculator",
  });
  expect(actions.map((action) => action.kind)).toEqual(["launch_app"]);
});

test("maps Playwright references, editable values, and disabled controls", () => {
  const elements = snapshotElements(
    [
      '- textbox "Search" [ref=e1]: ORD to JFK',
      '- button "Find flights" [ref=e2]',
      '- button "Book" [ref=e3] [disabled]',
    ].join("\n"),
  );
  expect(elements.map((element) => element.actions)).toEqual([["AXSetValue"], ["AXPress"], []]);
  expect(elements[0]?.value).toBe("ORD to JFK");
  expect(elements[1]?.element_token).toBe("e2");
});

test("validates the observed page URL before it can complete a task", () => {
  const text =
    '### Page\n- Page URL: https://example.com/\n- Page Title: Example\n### Snapshot\n```yaml\n- link "Learn more" [ref=e1]\n```';
  const window = parseSnapshot(text);
  expect(window.url).toBe("https://example.com/");
  expect(window.elements[0]?.label).toBe("Learn more");
  expect(() => parseSnapshot("### Error\nConnection failed")).toThrow();
});

test("settings accept provider-neutral HTTP endpoints and reject invalid URLs", () => {
  const settings = {
    decisionUrl: "http://127.0.0.1:8700/v1/systemone",
    decisionModel: "any-system-one-model",
    textUrl: "http://127.0.0.1:8080/v1/chat/completions",
    textModel: "small-text",
  };
  expect(settingsSchema.parse(settings)).toEqual(settings);
  expect(settingsSchema.safeParse({ ...settings, textUrl: "file:///tmp/model" }).success).toBe(
    false,
  );
});

test("identifies the Playwright connection tab without matching other pages", () => {
  const connection = "chrome-extension://mmlmfjhmonkocbjadbfplnigmagldckm/connect.html?client=test";
  const tabs = parseTabs(
    `### Result\n- 0: (current) [Welcome](${connection})\n- 1: [Page](https://example.com/)`,
  );
  expect(tabs.map((tab) => isConnectionPage(tab.url))).toEqual([true, false]);
  expect(isConnectionPage("https://example.com/connect.html")).toBe(false);
  expect(isConnectionPage("chrome-extension://mmlmfjhmonkocbjadbfplnigmagldckm/status.html")).toBe(
    false,
  );
});

test("routes a model-selected URL through a driver that can navigate", async () => {
  const plan = {
    goal: "open_url",
    url: "http://127.0.0.1:8792",
  } satisfies TaskPlan;
  const mode = await resolveMode({
    mode: "auto",
    task: "Open the URL",
    model: textFixture(plan),
    plan,
  });
  expect(mode).toBe("browser");
});
