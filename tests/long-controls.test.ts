import { expect, test } from "bun:test";
import { SystemOneHttpDecisionModel } from "../src/models/system-one.ts";
import { decisionRequestSchema } from "../src/models/system-one-schema.ts";
import type { Window } from "../src/agent/contracts.ts";

test("shows a late actionable target when the page has more than one hundred controls", async () => {
  const links = Array.from({ length: 120 }, (_unused, index) => ({
    element_index: index,
    element_token: `e${index}`,
    role: "link",
    label: `Archive ${index + 1}`,
    actions: ["AXPress"],
  }));
  const window: Window = {
    app_name: "Google Chrome",
    pid: 0,
    window_id: 0,
    window_title: "Documents",
    snapshot_id: "s1",
    url: "https://example.test/documents",
    elements: [
      ...links,
      {
        element_index: 120,
        element_token: "final",
        role: "link",
        label: "Final Audit",
        actions: ["AXPress"],
      },
    ],
  };
  let targetVisible = false;
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = decisionRequestSchema.parse(await request.json());
      if (body.questions.next_action.instructions.startsWith("Which action")) {
        targetVisible =
          body.state.includes("Further actionable controls") && body.state.includes("Final Audit");
      }
      const completion = body.questions.next_action.instructions.startsWith("Has this");
      const actionChoice = body.questions.next_action.instructions.startsWith("Which action");
      return Response.json({
        answers: {
          next_action: completion
            ? { choice: "A1", probabilities: { A0: 0, A1: 1 } }
            : { choice: "A0", probabilities: actionChoice ? { A0: 1 } : { A0: 1, A1: 0 } },
        },
      });
    },
  });
  try {
    await new SystemOneHttpDecisionModel(server.url.href, "test").choose({
      task: "Open Final Audit",
      mode: "browser",
      observation: { desktop: { apps: [], windows: [] }, window },
      actions: [
        { kind: "blocked", reason: "Blocked" },
        { kind: "finish", reason: "Done", summary: "Done" },
      ],
    });
    expect(targetVisible).toBe(true);
  } finally {
    await server.stop(true);
  }
});
