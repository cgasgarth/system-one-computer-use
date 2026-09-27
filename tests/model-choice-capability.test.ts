import { expect, test } from "bun:test";
import type { Action, ActionChoices, Window } from "../src/agent/contracts.ts";
import { SystemOneDecisionModel } from "../src/models/system-one.ts";
import { decisionRequestSchema } from "../src/models/system-one-schema.ts";
import { expectFailure } from "./fixtures.ts";

const MAX_JULIA_CHOICES = 20;
const APP_COUNT = 40;
const TOO_MANY_APPS = 400;
const TARGET = "App 39";
const TARGET_ROW_BYTES = 7600;
const MULTIPLE_PAGES = 2;
const OPERATION_AND_TARGET_REQUESTS = 2;
const LINK_COUNT = 400;
const LAST_LINK = LINK_COUNT - 1;
const LAST_SINGLETON_APP = 36;
const OVERSIZED_TEXT_CHARS = 9000;
const ELEMENTS_PER_ROW = 2;
const BASE_REQUEST_LIMIT = 20;
const NEXT_PAGE_DESCRIPTION =
  "None of these targets; inspect the next target page without taking an action.";
const RETURN_TO_OPERATIONS_DESCRIPTION =
  "None of these targets; choose another operation without taking an action.";

function apps(count: number): ActionChoices {
  const [first, ...rest] = Array.from({ length: count }, (_unused, index): Action => ({
    kind: "request_app",
    name: `App ${index}`,
    reason: `Open App ${index}`,
  }));
  if (first === undefined) {
    throw new Error("At least one application is required.");
  }
  return [first, ...rest, { kind: "blocked", reason: "Blocked" }];
}
function answer(choice: string, keys: readonly string[]): Response {
  return Response.json({
    answers: {
      next_action: {
        choice,
        probabilities: Object.fromEntries(keys.map((key) => [key, Number(key === choice)])),
      },
    },
  });
}
const input = {
  task: `Open ${TARGET}`,
  mode: "desktop" as const,
  observation: { desktop: { apps: [], windows: [] } },
};
function selectedChoice(instructions: string, criteria: Readonly<Record<string, string>>): string {
  const keys = Object.keys(criteria);
  if (instructions.startsWith("Which operation")) {
    return keys.find((key) => criteria[key]?.includes("installed application") === true) ?? "A0";
  }
  return (
    keys.find((key) => criteria[key]?.includes(TARGET) === true) ??
    keys.find((key) => criteria[key]?.includes("next target page") === true) ??
    "A0"
  );
}

function duplicateLinks(): {
  readonly elements: Window["elements"];
  readonly actions: ActionChoices;
} {
  const elements = Array.from({ length: LINK_COUNT }, (_unused, index) => [
    {
      element_index: index * ELEMENTS_PER_ROW + 1,
      element_token: `row:${index}`,
      role: "listitem",
      label: `Section ${index}`,
    },
    {
      element_index: index * ELEMENTS_PER_ROW + ELEMENTS_PER_ROW,
      element_token: `link:${index}`,
      parent_index: index * ELEMENTS_PER_ROW + 1,
      role: "link",
      label: "Article",
      href: `https://example.test/article/${index}`,
      actions: ["click"],
    },
  ]).flat();
  const [first, ...rest] = Array.from({ length: LINK_COUNT }, (_unused, index): Action => ({
    kind: "click_element",
    pid: 0,
    window_id: 0,
    element_token: `link:${index}`,
    reason: "Open Article",
  }));
  if (first === undefined) {
    throw new Error("The link fixture is empty.");
  }
  return { elements, actions: [first, ...rest, { kind: "blocked", reason: "Blocked" }] };
}

test("traverses exact app targets without discarding later pages", async () => {
  const counts: number[] = [];
  const pageTargets: string[][] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = decisionRequestSchema.parse(await request.json());
      const { criteria, instructions } = body.questions.next_action;
      const keys = Object.keys(criteria);
      counts.push(keys.length);
      expect(Buffer.byteLength(JSON.stringify(body))).toBeLessThanOrEqual(TARGET_ROW_BYTES);
      if (instructions.startsWith("Which action")) {
        pageTargets.push(Object.values(criteria));
      }
      const choice = selectedChoice(instructions, criteria);
      return answer(choice, keys);
    },
  });
  try {
    const result = await new SystemOneDecisionModel(server.url.href, "julia-latest", {
      maxChoices: MAX_JULIA_CHOICES,
    }).choose({ ...input, actions: apps(APP_COUNT) });
    expect(result.action).toMatchObject({ kind: "request_app", name: TARGET });
    expect(counts.length).toBeGreaterThan(1);
    expect(counts.every((count) => count <= MAX_JULIA_CHOICES)).toBe(true);
    expect(result.candidates?.length).toBeLessThanOrEqual(MAX_JULIA_CHOICES - 1);
    expect(pageTargets.length).toBeGreaterThan(MULTIPLE_PAGES);
    expect(pageTargets.flat().filter((description) => description.includes(TARGET))).toHaveLength(
      1,
    );
  } finally {
    await server.stop(true);
  }
});

test("does not reject a large action set before the model chooses an early target", async () => {
  let requests = 0;
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      requests += 1;
      const body = decisionRequestSchema.parse(await request.json());
      const keys = Object.keys(body.questions.next_action.criteria);
      const choice = body.questions.next_action.instructions.startsWith("Which operation")
        ? (keys.find(
            (key) =>
              body.questions.next_action.criteria[key]?.includes("installed application") === true,
          ) ?? "A0")
        : "A0";
      return answer(choice, keys);
    },
  });
  try {
    const result = await new SystemOneDecisionModel(server.url.href, "julia-latest", {
      maxChoices: MAX_JULIA_CHOICES,
    }).choose({ ...input, actions: apps(TOO_MANY_APPS) });
    expect(result.action).toMatchObject({ kind: "request_app", name: "App 0" });
    expect(requests).toBe(OPERATION_AND_TARGET_REQUESTS);
  } finally {
    await server.stop(true);
  }
});

test("retains duplicate labels and observed row identity on a later target page", async () => {
  const targetHref = `https://example.test/article/${LAST_LINK}`;
  const { elements, actions } = duplicateLinks();
  const seen: string[][] = [];
  let classified = 0;
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = decisionRequestSchema.parse(await request.json());
      const { instructions, criteria } = body.questions.next_action;
      const keys = Object.keys(criteria);
      if (instructions.startsWith("Which operation")) {
        const click = keys.find((key) => criteria[key]?.includes("Click a button") === true);
        return answer(click ?? "A0", keys);
      }
      if (instructions.startsWith("Would this exact control")) {
        classified += 1;
        return answer("A1", keys);
      }
      expect(Buffer.byteLength(JSON.stringify(body))).toBeLessThanOrEqual(TARGET_ROW_BYTES);
      seen.push(Object.values(criteria));
      const choice =
        keys.find((key) => criteria[key]?.includes(targetHref) === true) ??
        keys.find((key) => criteria[key]?.includes("next target page") === true) ??
        "A0";
      return answer(choice, keys);
    },
  });
  try {
    const result = await new SystemOneDecisionModel(server.url.href, "test", {
      maxChoices: MAX_JULIA_CHOICES,
    }).choose({
      task: `Open the article in Section ${LAST_LINK}`,
      mode: "browser",
      observation: {
        desktop: { apps: [], windows: [] },
        window: {
          app_name: "Browser",
          pid: 0,
          window_id: 0,
          window_title: "Article index",
          snapshot_id: "s1",
          url: "https://example.test/",
          elements,
        },
      },
      actions,
    });
    expect(result.action).toMatchObject({
      kind: "click_element",
      element_token: `link:${LAST_LINK}`,
    });
    expect(seen.length).toBeGreaterThan(BASE_REQUEST_LIMIT);
    expect(classified).toBe(1);
    expect(seen.flat().filter((description) => description.includes(targetHref))).toHaveLength(1);
    expect(
      seen.at(-1)?.some((description) => description.includes(`listitem "Section ${LAST_LINK}"`)),
    ).toBe(true);
  } finally {
    await server.stop(true);
  }
});

test("a final singleton page still requires a target choice after earlier pages were skipped", async () => {
  let targetRequests = 0;
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = decisionRequestSchema.parse(await request.json());
      const { instructions, criteria } = body.questions.next_action;
      const keys = Object.keys(criteria);
      if (instructions.startsWith("Which operation")) {
        return answer("A0", keys);
      }
      targetRequests += 1;
      const target = keys.find(
        (key) => criteria[key]?.includes(`App ${LAST_SINGLETON_APP}`) === true,
      );
      const next = keys.find((key) => criteria[key]?.includes("next target page") === true);
      if (target !== undefined) {
        expect(keys).toHaveLength(OPERATION_AND_TARGET_REQUESTS);
      }
      return answer(target ?? next ?? "A0", keys);
    },
  });
  try {
    const result = await new SystemOneDecisionModel(server.url.href, "julia-latest", {
      maxChoices: MAX_JULIA_CHOICES,
    }).choose({ ...input, actions: apps(LAST_SINGLETON_APP + 1) });
    expect(result.action).toMatchObject({ kind: "request_app", name: `App ${LAST_SINGLETON_APP}` });
    expect(targetRequests).toBeGreaterThan(MULTIPLE_PAGES);
  } finally {
    await server.stop(true);
  }
});

test("all page skips reject only that operation and leave another observed operation", async () => {
  let targetRequests = 0;
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = decisionRequestSchema.parse(await request.json());
      const { instructions, criteria } = body.questions.next_action;
      const keys = Object.keys(criteria);
      if (instructions.startsWith("Which operation")) {
        return answer("A0", keys);
      }
      targetRequests += 1;
      const next = keys.find((key) => criteria[key]?.includes("next target page") === true);
      return answer(next ?? keys.at(-1) ?? "A0", keys);
    },
  });
  try {
    const result = await new SystemOneDecisionModel(server.url.href, "julia-latest", {
      maxChoices: MAX_JULIA_CHOICES,
    }).choose({ ...input, actions: apps(APP_COUNT) });
    expect(result.action.kind).toBe("blocked");
    expect(targetRequests).toBeGreaterThan(MULTIPLE_PAGES);
    expect(result.rejectedOperations).toHaveLength(1);
  } finally {
    await server.stop(true);
  }
});

test("returns to another operation from the first target page", async () => {
  const { elements, actions } = duplicateLinks();
  const [first, ...rest] = actions.filter((action) => action.kind === "click_element");
  if (first === undefined) {
    throw new Error("The link fixture is empty.");
  }
  let targetRequests = 0;
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = decisionRequestSchema.parse(await request.json());
      const { criteria, instructions } = body.questions.next_action;
      const keys = Object.keys(criteria);
      if (instructions.startsWith("Which operation")) {
        return answer("A0", keys);
      }
      targetRequests += 1;
      expect(Object.values(criteria)).toContain(RETURN_TO_OPERATIONS_DESCRIPTION);
      expect(Object.values(criteria)).toContain(NEXT_PAGE_DESCRIPTION);
      const back = keys.find((key) => criteria[key] === RETURN_TO_OPERATIONS_DESCRIPTION);
      return answer(back ?? "A0", keys);
    },
  });
  try {
    const result = await new SystemOneDecisionModel(server.url.href, "test").choose({
      ...input,
      mode: "browser",
      observation: {
        desktop: { apps: [], windows: [] },
        window: {
          app_name: "Browser",
          pid: 0,
          window_id: 0,
          window_title: "Article index",
          snapshot_id: "s1",
          url: "https://example.test/",
          elements,
        },
      },
      actions: [first, ...rest, { kind: "finish", reason: "Finish", summary: "Done" }],
    });
    expect(result.action.kind).toBe("finish");
    expect(targetRequests).toBe(1);
    expect(result.rejectedOperations).toHaveLength(1);
  } finally {
    await server.stop(true);
  }
});

test("a sole selected Finish does not build an unused oversized target request", async () => {
  const model = new SystemOneDecisionModel("http://127.0.0.1:1", "test");
  const result = await model.choose({
    ...input,
    task: "x".repeat(OVERSIZED_TEXT_CHARS),
    actions: [{ kind: "finish", reason: "Finish", summary: "Done" }],
  });
  expect(result.action.kind).toBe("finish");
});

test("reports lossless capacity when the state or one target cannot fit", async () => {
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = decisionRequestSchema.parse(await request.json());
      const keys = Object.keys(body.questions.next_action.criteria);
      return answer("A0", keys);
    },
  });
  try {
    const model = new SystemOneDecisionModel(server.url.href, "julia-latest", {
      maxChoices: MAX_JULIA_CHOICES,
    });
    await expectFailure(
      model.choose({ ...input, task: "x".repeat(OVERSIZED_TEXT_CHARS), actions: apps(APP_COUNT) }),
      "capacity_choices:",
    );
    await expectFailure(
      model.choose({
        ...input,
        actions: [
          { kind: "request_app", name: TARGET, reason: "x".repeat(OVERSIZED_TEXT_CHARS) },
          { kind: "request_app", name: "Other", reason: "Open Other" },
          { kind: "blocked", reason: "Blocked" },
        ],
      }),
      "capacity_choices:",
    );
  } finally {
    await server.stop(true);
  }
});

test("uses the already-selected sole target without asking a two-choice model", async () => {
  const model = new SystemOneDecisionModel("http://127.0.0.1:1", "julia-latest", {
    maxChoices: MAX_JULIA_CHOICES,
  });
  const result = await model.choose({
    ...input,
    actions: [{ kind: "request_app", name: TARGET, reason: `Open ${TARGET}` }],
  });
  expect(result.action).toMatchObject({ kind: "request_app", name: TARGET });
});
