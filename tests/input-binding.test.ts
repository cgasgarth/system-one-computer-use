import { expect, test } from "bun:test";
import type { Window } from "../src/agent/contracts.ts";
import type { TextModel } from "../src/models/text.ts";
import type { ActionResult } from "../src/agent/types.ts";
import type { ManagedComputer } from "../src/computer/types.ts";
import { enterText, openUrl } from "../src/agent/input.ts";
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
    elements.push({ ...element });
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

test("rejects a replacement field with the same label and value when frames are absent", async () => {
  const original = windowFixture();
  const replacement: Window = {
    ...original,
    snapshot_id: "replacement",
    elements: original.elements.map((element) => ({ ...element, element_token: "other:1" })),
  };
  const fixture = inputFixture(original, replacement);
  await expectFailure(fixture.run(), "selected input changed");
  expect(fixture.typed).toEqual([]);
});

test("verifies a native search write when its AX label becomes the query", async () => {
  const { computer, typed } = computerFixture();
  const search = {
    element_index: 1,
    element_token: "search:1",
    role: "AXTextField",
    subrole: "AXSearchField",
    label: "Search",
    value: "",
    editable: true,
    frame: { x: 10, y: 20, w: 180, h: 28 },
  };
  const window: Window = { ...windowFixture(), elements: [search] };
  const bound: ManagedComputer = {
    ...computer,
    async window() {
      const value = typed.at(-1) ?? "";
      return {
        ...window,
        elements: [{ ...search, element_token: "search:fresh", label: value || "Search", value }],
      };
    },
  };
  const result = await enterText({
    action: {
      kind: "compose_text",
      pid: window.pid,
      window_id: window.window_id,
      element_token: search.element_token,
      reason: "Type text into search field",
    },
    observation: { desktop: desktopFixture(), window },
    computer: bound,
    options: {
      task: "Open Playback Test.mp4 in the selected folder",
      applications: [],
      computer: () => bound,
      text: {
        async generate(input) {
          expect(input.field?.kind).toBe("search");
          return "Playback Test.mp4";
        },
      },
      decision: {
        async choose() {
          throw new Error("No decision needed");
        },
      },
    },
  });
  expect(typed).toEqual(["Playback Test.mp4"]);
  expect(result.verifiedField?.value).toBe("Playback Test.mp4");
  expect(result.satisfiedInput).toBeDefined();
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

test("rejects a text-helper URL error without leaking validator JSON", async () => {
  const { computer } = computerFixture();
  let navigations = 0;
  const browser: ManagedComputer = {
    ...computer,
    async navigate() {
      navigations += 1;
    },
  };
  await expectFailure(
    openUrl({
      action: { kind: "request_url", reason: "Open the requested page" },
      observation: { desktop: desktopFixture(), window: windowFixture() },
      computer: browser,
      options: {
        task: "Open a page",
        applications: [],
        computer: () => browser,
        text: {
          async generate() {
            return "not a web address";
          },
        },
        decision: {
          async choose() {
            throw new Error("No decision needed");
          },
        },
      },
    }),
    "valid web address",
  );
  expect(navigations).toBe(0);
});

test("explains an unavailable URL text helper", async () => {
  const { computer } = computerFixture();
  const browser: ManagedComputer = {
    ...computer,
    async navigate() {
      throw new Error("Unexpected navigation");
    },
  };
  await expectFailure(
    openUrl({
      action: { kind: "request_url", reason: "Open the requested page" },
      observation: { desktop: desktopFixture(), window: windowFixture() },
      computer: browser,
      options: {
        task: "Open a page",
        applications: [],
        computer: () => browser,
        text: {
          async generate() {
            throw new Error("Service unavailable");
          },
        },
        decision: {
          async choose() {
            throw new Error("No decision needed");
          },
        },
      },
    }),
    "Could not get a web address",
  );
});

test("normalizes a domain named in the current request", async () => {
  const { computer } = computerFixture();
  const opened: string[] = [];
  let requests = 0;
  const browser: ManagedComputer = {
    ...computer,
    async navigate(url) {
      opened.push(url);
    },
  };
  await openUrl({
    action: { kind: "request_url", reason: "Open the requested page" },
    observation: { desktop: desktopFixture(), window: windowFixture() },
    computer: browser,
    options: {
      task: "Open example.test in Chrome",
      applications: [],
      computer: () => browser,
      text: {
        async generate() {
          requests += 1;
          return "example.test";
        },
      },
      decision: {
        async choose() {
          throw new Error("No decision needed");
        },
      },
    },
  });
  expect(opened).toEqual(["https://example.test"]);
  expect(requests).toBe(1);
});

test("uses a site homepage when an unobserved article path was invented", async () => {
  const { computer } = computerFixture();
  const opened: string[] = [];
  const browser: ManagedComputer = {
    ...computer,
    async navigate(url) {
      opened.push(url);
    },
  };
  await openUrl({
    action: { kind: "request_url", reason: "Open the requested page" },
    observation: { desktop: desktopFixture(), window: windowFixture() },
    computer: browser,
    options: {
      task: "Open the reference site's article about maps",
      applications: [],
      computer: () => browser,
      text: {
        async generate() {
          return "https://reference.example/wiki/Maps";
        },
      },
      decision: {
        async choose() {
          throw new Error("No decision needed");
        },
      },
    },
  });
  expect(opened).toEqual(["https://reference.example"]);
});

test("asks the writer to choose when the request contains two different URLs", async () => {
  const { computer } = computerFixture();
  const opened: string[] = [];
  let requests = 0;
  const browser: ManagedComputer = {
    ...computer,
    async navigate(url) {
      opened.push(url);
    },
  };
  await openUrl({
    action: { kind: "request_url", reason: "Open one supplied URL" },
    observation: { desktop: desktopFixture(), window: windowFixture() },
    computer: browser,
    options: {
      task: "Open https://example.test/first or https://example.test/second",
      applications: [],
      computer: () => browser,
      text: {
        async generate() {
          requests += 1;
          return "https://example.test/second";
        },
      },
      decision: {
        async choose() {
          throw new Error("No decision needed");
        },
      },
    },
  });
  expect(requests).toBe(1);
  expect(opened).toEqual(["https://example.test/second"]);
});
