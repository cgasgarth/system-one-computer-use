import { expect, test } from "bun:test";
import type { ActionChoices } from "../src/agent/contracts.ts";
import { SystemOneDecisionModel } from "../src/models/system-one.ts";
import { decisionRequestSchema } from "../src/models/system-one-schema.ts";
import { desktopFixture, windowFixture } from "./fixtures.ts";

const BUTTON_COUNT = 40;
const APP_COUNT = 113;
const EXPECTED_REQUESTS = 2;
const EXPECTED_APP_REQUESTS = 2;

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
      if (instructions.startsWith("Has this user request")) {
        return answer("A1", criteria);
      }
      if (instructions.startsWith("Which action")) {
        const searchKey = keys.find((key) => criteria[key]?.includes("Search") === true);
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
