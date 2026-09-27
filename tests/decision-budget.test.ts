import { expect, test } from "bun:test";
import type { ActionChoices } from "../src/agent/contracts.ts";
import { SystemOneDecisionModel } from "../src/models/system-one.ts";
import { decisionRequestSchema } from "../src/models/system-one-schema.ts";
import { desktopFixture, expectFailure, windowFixture } from "./fixtures.ts";

const BUTTON_COUNT = 40;
const APP_COUNT = 113;
const EXPECTED_REQUESTS = 1;
const EXPECTED_APP_REQUESTS = 2;
const MANY_FIELDS = 30;
const MAX_DECISION_REQUESTS = 20;
const INFERENCE_DELAY_MS = 200;
const STOP_AFTER_MS = 20;

function answer(choice: string, criteria: Readonly<Record<string, string>>): Response {
  return Response.json({
    answers: {
      next_action: {
        choice,
        probabilities: Object.fromEntries(
          Object.keys(criteria).map((key) => [key, Number(key === choice)]),
        ),
      },
    },
  });
}

function makeButtons(): {
  element_index: number;
  element_token: string;
  role: string;
  label: string;
  actions: string[];
}[] {
  return Array.from({ length: BUTTON_COUNT }, (_item, index) => ({
    element_index: index + 1,
    element_token: `button:${index}`,
    role: "AXButton",
    label: `Other control ${index}`,
    actions: ["AXPress"],
  }));
}

test("chooses the search field among many visible controls without serial checks", async () => {
  let requests = 0;
  const buttons = makeButtons();
  const search = {
    element_index: BUTTON_COUNT + 1,
    element_token: "search",
    role: "AXTextField",
    subrole: "AXSearchField",
    label: "Search",
    value: "",
    editable: true,
    actions: ["AXSetValue"],
  };
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      requests += 1;
      const body = decisionRequestSchema.parse(await request.json());
      const { criteria, instructions } = body.questions.next_action;
      const keys = Object.keys(criteria);
      if (instructions.startsWith("Which action")) {
        const searchKey = keys.find((key) => criteria[key]?.includes("search field") === true);
        return answer(searchKey ?? "A0", criteria);
      }
      return answer("A0", criteria);
    },
  });
  try {
    const [firstButton, ...otherButtons] = buttons;
    if (firstButton === undefined) {
      throw new Error("Missing first button");
    }
    const actions: ActionChoices = [
      {
        kind: "click_element",
        pid: 7,
        window_id: 9,
        element_token: firstButton.element_token,
        reason: `Activate ${firstButton.label}`,
      },
      ...otherButtons.map((button) => ({
        kind: "click_element" as const,
        pid: 7,
        window_id: 9,
        element_token: button.element_token,
        reason: `Activate ${button.label}`,
      })),
      {
        kind: "compose_text",
        pid: 7,
        window_id: 9,
        element_token: "search",
        reason: "Type in Search",
      },
    ];
    const result = await new SystemOneDecisionModel(server.url.href, "model").choose({
      task: "Find the requested person in Messages",
      mode: "desktop",
      observation: {
        desktop: desktopFixture(),
        window: { ...windowFixture(), elements: [...buttons, search] },
      },
      actions,
    });
    expect(result.action.kind).toBe("compose_text");
    expect(result.checks).toEqual([]);
    expect(requests).toBe(EXPECTED_REQUESTS);
  } finally {
    await server.stop(true);
  }
});

test.each([false, true])(
  "selects from the full installed app list with reversed order: %p",
  async (reverse) => {
    let requests = 0;
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        requests += 1;
        const body = decisionRequestSchema.parse(await request.json());
        const { criteria, instructions } = body.questions.next_action;
        const keys = Object.keys(criteria);
        const selected = instructions.startsWith("Which operation")
          ? keys.find((key) => criteria[key]?.includes("Open an installed application") === true)
          : keys.find((key) => criteria[key]?.includes("Messages") === true);
        return answer(selected ?? "A0", criteria);
      },
    });
    try {
      const names = [
        "Messages",
        ...Array.from({ length: APP_COUNT }, (_item, index) => `App ${index}`),
      ];
      const ordered = reverse ? names.toReversed() : names;
      const actions: ActionChoices = [
        { kind: "select_surface", surface: "browser", reason: "Use Chrome" },
        ...ordered.map((name) => ({
          kind: "request_app" as const,
          name,
          reason: `Open installed application ${name}`,
        })),
        { kind: "blocked", reason: "Need user help" },
      ];
      const result = await new SystemOneDecisionModel(server.url.href, "model").choose({
        task: "Open my latest text in iMessage",
        mode: "desktop",
        observation: { desktop: { apps: [], windows: [] } },
        actions,
      });
      expect(result.action.kind).toBe("request_app");
      if (result.action.kind === "request_app") {
        expect(result.action.name).toBe("Messages");
      }
      expect(requests).toBe(EXPECTED_APP_REQUESTS);
    } finally {
      await server.stop(true);
    }
  },
);

test("stops a long field-readiness cascade with an explicit stalled reason", async () => {
  let requests = 0;
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      requests += 1;
      const body = decisionRequestSchema.parse(await request.json());
      const readiness = body.questions.next_action.instructions.startsWith(
        "Is a user-requested change",
      );
      return answer(readiness ? "A1" : "A0", body.questions.next_action.criteria);
    },
  });
  try {
    const window = {
      ...windowFixture(),
      elements: [
        {
          element_index: 0,
          element_token: "save",
          role: "button",
          label: "Save",
          actions: ["AXPress"],
        },
        ...Array.from({ length: MANY_FIELDS }, (_unused, index) => ({
          element_index: index + 1,
          element_token: `field-${index}`,
          role: "textbox",
          label: `Field ${index}`,
          value: "ready",
          editable: true,
        })),
      ],
    };
    await expectFailure(
      new SystemOneDecisionModel(server.url.href, "model").choose({
        task: "Save these fields",
        observation: { desktop: desktopFixture(), window },
        actions: [
          {
            kind: "click_element",
            pid: window.pid,
            window_id: window.window_id,
            element_token: "save",
            reason: "Save",
          },
        ],
        async inspectClick() {
          return { kind: "form_submit" };
        },
      }),
      "Decision stalled on this observation",
    );
    expect(requests).toBe(MAX_DECISION_REQUESTS);
  } finally {
    await server.stop(true);
  }
});

test("caller Stop aborts a pending model request without starting another", async () => {
  const controller = new AbortController();
  let starts = 0;
  const server = Bun.serve({
    port: 0,
    fetch() {
      return Response.json({
        answers: {
          next_action: { choice: "A1", probabilities: { A0: 0, A1: 1 } },
        },
      });
    },
  });
  try {
    let failed = false;
    try {
      await new SystemOneDecisionModel(server.url.href, "model").choose({
        task: "Open the requested item",
        observation: { desktop: desktopFixture(), window: windowFixture() },
        actions: [
          { kind: "finish", reason: "Done", summary: "Done" },
          { kind: "blocked", reason: "Need user help" },
        ],
        signal: controller.signal,
        onRequest(event) {
          if (event.status === "start") {
            starts += 1;
            controller.abort();
          }
        },
      });
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
    expect(controller.signal.aborted).toBe(true);
    expect(starts).toBe(1);
  } finally {
    await server.stop(true);
  }
});

test("caller Stop aborts an in-flight model request", async () => {
  const controller = new AbortController();
  const events: string[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch() {
      await Bun.sleep(INFERENCE_DELAY_MS);
      return Response.json({
        answers: { next_action: { choice: "A0", probabilities: { A0: 1, A1: 0 } } },
      });
    },
  });
  try {
    const timer = setTimeout(() => {
      controller.abort();
    }, STOP_AFTER_MS);
    try {
      await expectFailure(
        new SystemOneDecisionModel(server.url.href, "model").choose({
          task: "Open the requested item",
          observation: { desktop: desktopFixture(), window: windowFixture() },
          actions: [
            { kind: "finish", reason: "Done", summary: "Done" },
            { kind: "blocked", reason: "Need user help" },
          ],
          signal: controller.signal,
          onRequest(event) {
            events.push(event.status);
          },
        }),
        "abort",
      );
    } finally {
      clearTimeout(timer);
    }
    expect(events).toEqual(["start", "error"]);
  } finally {
    await server.stop(true);
  }
});
