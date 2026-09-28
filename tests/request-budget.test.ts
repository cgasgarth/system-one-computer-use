import { expect, test } from "bun:test";
import { boundedContext, budgetRequest } from "../src/models/request-budget.ts";
import { SystemOneDecisionModel } from "../src/models/system-one.ts";
import { decisionRequestSchema } from "../src/models/system-one-schema.ts";
import type { Action, Window } from "../src/agent/contracts.ts";

const BYTE_LIMIT = 7600;
const ROW_COUNT = 200;
const LONG_REPEAT = 5000;
const TASK = "Open the latest order. Do not buy or cancel anything.";

test("budgets escaped UTF-8 context while preserving task and exact choices", () => {
  const criteria = { A0: 'Open order "東京 👩🏽‍💻"', A1: "Stop" };
  const body = budgetRequest((limit) => ({
    model: "test",
    state: `User request: ${TASK}\n${boundedContext(['👩🏽‍💻 東京 "quoted"\n'.repeat(LONG_REPEAT)], limit).join("\n")}`,
    questions: { next_action: { type: "choice", instructions: TASK, criteria } },
  }));
  expect(Buffer.byteLength(JSON.stringify(body))).toBeLessThanOrEqual(BYTE_LIMIT);
  expect(body.state).toContain(TASK);
  expect(body.state).toContain("[Context shortened]");
  expect(body.questions.next_action.criteria).toEqual(criteria);
});

function orderElements(): Window["elements"] {
  return Array.from({ length: ROW_COUNT }, (_value, index) => ({
    element_index: index,
    element_token: `order:${index}`,
    role: "link",
    label: `Order ${index}`,
    href: `https://example.test/orders/${index}`,
    actions: ["AXPress"],
  }));
}

test("large page and follow-up context can reach the last target through bounded wire requests", async () => {
  const requested: string[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = decisionRequestSchema.parse(await request.json());
      expect(Buffer.byteLength(JSON.stringify(body))).toBeLessThanOrEqual(BYTE_LIMIT);
      expect(body.questions.next_action.instructions).toContain(TASK);
      const criteria = Object.entries(body.questions.next_action.criteria);
      const operation = body.questions.next_action.instructions.startsWith("Which operation");
      if (!operation) {
        expect(body.state).toContain("Selected operation for this next step:");
        requested.push(
          ...criteria
            .map(([, value]) => value)
            .filter((value) => value.includes("https://example.test/orders/")),
        );
      }
      const selected = operation
        ? criteria.find(([, value]) => value.includes("Click a button"))
        : (criteria.find(([, value]) => value.includes(`/orders/${ROW_COUNT - 1}`)) ??
          criteria.find(([, value]) => value.includes("next target page")));
      if (selected === undefined) {
        throw new Error("Expected a reachable target or next page");
      }
      return Response.json({
        answers: {
          next_action: {
            choice: selected[0],
            probabilities: Object.fromEntries(
              criteria.map(([key]) => [key, Number(key === selected[0])]),
            ),
          },
        },
      });
    },
  });
  try {
    const elements = orderElements();
    const [first, ...rest] = elements.map((element): Action => ({
      kind: "click_element",
      pid: 0,
      window_id: 0,
      element_token: element.element_token,
      reason: `Open ${element.label}`,
    }));
    if (first === undefined) {
      throw new Error("Missing fixture target");
    }
    const result = await new SystemOneDecisionModel(server.url.href, "test").choose({
      task: TASK,
      mode: "browser",
      context: 'Earlier "screen" 東京 '.repeat(LONG_REPEAT),
      feedback: "Previous content and history. ".repeat(LONG_REPEAT),
      observation: {
        desktop: { apps: [], windows: [] },
        window: {
          app_name: "Browser",
          pid: 0,
          window_id: 0,
          window_title: "Orders",
          snapshot_id: "current",
          url: "https://example.test/orders",
          elements,
        },
      },
      actions: [first, ...rest, { kind: "blocked", reason: "Stop" }],
    });
    expect(result.action).toMatchObject({
      kind: "click_element",
      element_token: `order:${ROW_COUNT - 1}`,
    });
    expect(requested).toHaveLength(ROW_COUNT);
  } finally {
    await server.stop(true);
  }
});
