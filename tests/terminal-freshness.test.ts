import { expect, test } from "bun:test";
import { runTask } from "../src/agent/loop.ts";
import type { TaskStep } from "../src/agent/types.ts";
import type { ManagedComputer } from "../src/computer/types.ts";

test("rechecks the selected screen before accepting Finish", async () => {
  let content = "before";
  let decisions = 0;
  const steps: TaskStep[] = [];
  const computer: ManagedComputer = {
    async desktop() {
      return {
        apps: [{ name: "Google Chrome", pid: 0 }],
        windows: [{ app_name: "Google Chrome", pid: 0, window_id: 0, title: "Page" }],
      };
    },
    async window() {
      return {
        app_name: "Google Chrome",
        pid: 0,
        window_id: 0,
        window_title: "Page",
        url: "https://example.com/",
        snapshot_id: crypto.randomUUID(),
        elements: [
          { element_index: 0, element_token: "content", role: "paragraph", value: content },
        ],
      };
    },
    async clickElement() {
      /* This test has no input action. */
    },
    async typeText() {
      /* This test has no input action. */
    },
    async pressKey() {
      /* This test has no input action. */
    },
    async launchApp() {
      /* This test uses the selected browser. */
    },
    async inspectClick() {
      return { kind: "unclassified" };
    },
    async close() {
      /* The driver is local to this test. */
    },
  };
  const result = await runTask({
    task: "Read the current page",
    preferredSurface: "browser",
    applications: [],
    computer() {
      return computer;
    },
    decision: {
      async choose() {
        decisions += 1;
        if (decisions === 1) {
          content = "after";
        }
        return {
          action: { kind: "finish" as const, reason: "The page is ready", summary: "Done" },
          latencyMs: 1,
          probabilities: { A0: 1 },
        };
      },
    },
    text: {
      async generate() {
        return "";
      },
    },
    onStep(step) {
      steps.push(step);
    },
  });
  expect(result.status).toBe("complete");
  const expectedDecisions = 2;
  expect(decisions).toBe(expectedDecisions);
  expect(steps[0]?.error).toContain("screen changed before Finish");
  expect(steps[0]?.terminalObservation).toContain("after");
  expect(steps[1]?.error).toBeUndefined();
});
