import { expect, test } from "bun:test";
import { runTask } from "../src/agent/loop.ts";
import type { Window } from "../src/agent/contracts.ts";
import type { ManagedComputer } from "../src/computer/types.ts";
import { textFixture } from "./fixtures.ts";

test("rejects a browser click when a same-label control is replaced after decision", async () => {
  let token = "e1";
  let clicks = 0;
  const browser: ManagedComputer = {
    async desktop() {
      return {
        apps: [{ name: "Google Chrome", pid: 0 }],
        windows: [{ app_name: "Google Chrome", pid: 0, window_id: 0, title: "Task" }],
      };
    },
    async window(): Promise<Window> {
      return {
        app_name: "Google Chrome",
        pid: 0,
        window_id: 0,
        window_title: "Task",
        snapshot_id: crypto.randomUUID(),
        url: "https://example.test/task",
        elements: [
          {
            element_index: 0,
            element_token: token,
            role: "button",
            label: "Submit",
            actions: ["AXPress"],
          },
        ],
      };
    },
    async clickElement() {
      clicks += 1;
    },
    // eslint-disable-next-line typescript/promise-function-async
    inspectClick() {
      return Promise.resolve({ kind: "unclassified" });
    },
    async launchApp() {
      /* Not used. */
    },
    async typeText() {
      /* Not used. */
    },
    async pressKey() {
      /* Not used. */
    },
    async close() {
      /* Not used. */
    },
  };
  let decisions = 0;
  const result = await runTask({
    task: "Submit this form",
    applications: [],
    preferredSurface: "browser",
    computer: () => browser,
    text: textFixture(),
    decision: {
      async choose(input) {
        decisions += 1;
        if (decisions === 1) {
          const action = input.actions.find((candidate) => candidate.kind === "click_element");
          if (action === undefined) {
            throw new Error("Missing click choice");
          }
          token = "e2";
          return { action, probabilities: { A0: 1 }, latencyMs: 1 };
        }
        const action = input.actions.find((candidate) => candidate.kind === "blocked");
        if (action === undefined) {
          throw new Error("Missing blocked choice");
        }
        return { action, probabilities: { A0: 1 }, latencyMs: 1 };
      },
    },
  });
  expect(clicks).toBe(0);
  expect(result.steps[0]?.error).toContain("browser changed before the click");
  expect(result.status).toBe("blocked");
});
