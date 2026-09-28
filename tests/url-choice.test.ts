import { expect, test } from "bun:test";
import { runTask } from "../src/agent/loop.ts";
import { actionGroups } from "../src/models/decision-context.ts";
import { taskUrls } from "../src/agent/url-addresses.ts";
import type { Decision, DecisionInput } from "../src/models/system-one.ts";
import type { ManagedComputer } from "../src/computer/types.ts";
import { computerFixture } from "./fixtures.ts";

const SUPPLIED_URL = "https://example.test/library/page/?view=recent";
const SUBJECT_URL = "https://example.test/article";
const DESTINATION_URL = "https://wikipedia.org/";
const PREVIOUS_URL = "https://example.test/roadmap";
const NEW_URL = "https://new.example.test/brief";
function selected(
  input: DecisionInput,
  kind: "select_surface" | "navigate" | "request_url" | "finish",
): Decision {
  const action = input.actions.find(
    (candidate) =>
      candidate.kind === kind &&
      (candidate.kind !== "select_surface" || candidate.surface === "browser"),
  );
  if (action === undefined) {
    throw new Error(`Missing ${kind} option`);
  }
  return { action, latencyMs: 1, probabilities: { A0: 1 } };
}
function selectedUrl(input: DecisionInput, url: string): Decision {
  const action = input.actions.find(
    (candidate) => candidate.kind === "navigate" && candidate.url === url,
  );
  if (action === undefined) {
    throw new Error(`Missing URL option ${url}`);
  }
  return { action, latencyMs: 1, probabilities: { A0: 1 } };
}
function browserFixture(): {
  readonly desktop: ManagedComputer;
  readonly browser: ManagedComputer;
  readonly navigations: readonly string[];
  readonly currentUrl: () => string;
} {
  const { computer: desktop } = computerFixture();
  const navigations: string[] = [];
  let url = "about:blank";
  const browser: ManagedComputer = {
    ...desktop,
    async desktop() {
      return {
        apps: [{ name: "Google Chrome", pid: 0 }],
        windows: [{ app_name: "Google Chrome", pid: 0, window_id: 0, title: "Browser" }],
      };
    },
    async window() {
      return {
        app_name: "Google Chrome",
        pid: 0,
        window_id: 0,
        window_title: "Browser",
        snapshot_id: url,
        url,
        elements: [],
      };
    },
    async navigate(destination) {
      url = destination;
      navigations.push(destination);
    },
    async restore() {
      // The saved tab is unavailable. S1 must choose whether to revisit its URL.
    },
  };
  return { desktop, browser, navigations, currentUrl: () => url };
}

test("S1 selects a literal URL action with no text-helper call", async () => {
  const fixture = browserFixture();
  let writerCalls = 0;
  const result = await runTask({
    task: `Open ${SUPPLIED_URL}`,
    applications: [],
    computer: (mode) => (mode === "browser" ? fixture.browser : fixture.desktop),
    text: {
      async generate() {
        writerCalls += 1;
        return "https://other.test/";
      },
    },
    decision: {
      async choose(input) {
        if (input.mode === undefined) {
          return selected(input, "select_surface");
        }
        return selected(input, fixture.currentUrl() === "about:blank" ? "navigate" : "finish");
      },
    },
  });
  expect(result.status).toBe("complete");
  expect(fixture.navigations).toEqual([SUPPLIED_URL]);
  expect(writerCalls).toBe(0);
  expect(result.steps.map((step) => step.action.kind)).toEqual([
    "select_surface",
    "navigate",
    "finish",
  ]);
});

test("a URL used as subject does not become the browser destination without S1 selection", async () => {
  const fixture = browserFixture();
  let writerCalls = 0;
  const result = await runTask({
    task: `On Wikipedia, search for ${SUBJECT_URL}`,
    applications: [],
    computer: (mode) => (mode === "browser" ? fixture.browser : fixture.desktop),
    text: {
      async generate() {
        writerCalls += 1;
        return DESTINATION_URL;
      },
    },
    decision: {
      async choose(input) {
        if (input.mode === undefined) {
          return selected(input, "select_surface");
        }
        if (fixture.currentUrl() === "about:blank") {
          expect(
            input.actions.some(
              (action) => action.kind === "navigate" && action.url === SUBJECT_URL,
            ),
          ).toBe(true);
          return selected(input, "request_url");
        }
        return selected(input, "finish");
      },
    },
  });
  expect(result.status).toBe("complete");
  expect(fixture.navigations).toEqual([DESTINATION_URL]);
  expect(writerCalls).toBe(1);
});

test("the operation summary names literal URL targets before target choice", () => {
  const actions = [
    { kind: "navigate" as const, url: SUPPLIED_URL, reason: "Open supplied URL" },
    { kind: "request_url" as const, reason: "Get another URL" },
  ];
  const group = actionGroups(actions).find((entry) => entry.kind === "navigate");
  expect(group?.description).toContain(SUPPLIED_URL);
});

test("URL syntax keeps valid parenthesis paths and query punctuation", () => {
  expect(taskUrls("Open https://en.wikipedia.org/wiki/Chicago_(band)")).toEqual([
    "https://en.wikipedia.org/wiki/Chicago_(band)",
  ]);
  expect(taskUrls("Open https://example.test/search?q=bang!.")).toEqual([
    "https://example.test/search?q=bang!.",
  ]);
});

test("URL syntax unwraps matching outer delimiters without removing a trailing slash", () => {
  expect(taskUrls('Open "https://example.test/path/"')).toEqual(["https://example.test/path/"]);
  expect(taskUrls("Open <https://example.test/path/>")).toEqual(["https://example.test/path/"]);
});

for (const destination of [PREVIOUS_URL, NEW_URL]) {
  test(`a saved browser URL is offered but S1 may choose ${destination === PREVIOUS_URL ? "history" : "a fresh URL"}`, async () => {
    const fixture = browserFixture();
    const previousSurface = {
      kind: "browser" as const,
      browserId: "chrome",
      tabId: "task",
      providerTabId: "provider-task",
      extensionInstanceId: "extension-test",
      url: PREVIOUS_URL,
      title: "Roadmap",
    };
    const task = destination === PREVIOUS_URL ? "Open it again" : `Open ${NEW_URL}`;
    let writerCalls = 0;
    const result = await runTask({
      task,
      preferredSurface: "browser",
      previousSurface,
      applications: [],
      computer: (mode) => (mode === "browser" ? fixture.browser : fixture.desktop),
      text: {
        async generate() {
          writerCalls += 1;
          return "https://wrong.example.test/";
        },
      },
      decision: {
        async choose(input) {
          if (fixture.currentUrl() === "about:blank") {
            const prior = input.actions.find(
              (action) => action.kind === "navigate" && action.url === PREVIOUS_URL,
            );
            expect(prior?.reason).toContain("previous session browser page");
            const navigation = actionGroups(input.actions).find(
              (group) => group.kind === "navigate",
            );
            expect(navigation?.description).toContain(PREVIOUS_URL);
            return selectedUrl(input, destination);
          }
          return selected(input, "finish");
        },
      },
    });
    expect(result.status).toBe("complete");
    expect(fixture.navigations).toEqual([destination]);
    expect(writerCalls).toBe(0);
  });
}
