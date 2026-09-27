import { expect, test } from "bun:test";
import { runTask } from "../src/agent/loop.ts";
import type { TaskStep } from "../src/agent/types.ts";
import type { ManagedComputer } from "../src/computer/types.ts";

const VERIFIED_DECISIONS = 2;
const REJECTED_DECISIONS = 3;
function testComputer(readContent: () => string): ManagedComputer {
  return {
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
          { element_index: 0, element_token: "content", role: "paragraph", value: readContent() },
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
}
for (const stillComplete of [true, false]) {
  test(`rechecks changed content before Finish (still complete: ${stillComplete})`, async () => {
    let content = "before";
    let decisions = 0;
    const steps: TaskStep[] = [];
    const computer = testComputer(() => content);
    const result = await runTask({
      task: "Read the current page",
      preferredSurface: "browser",
      applications: [],
      computer() {
        return computer;
      },
      decision: {
        async choose(input) {
          decisions += 1;
          if (decisions === 1) {
            content = "after";
          }
          const complete =
            stillComplete || input.observation.window?.elements[0]?.value === "before";
          return {
            action: complete
              ? { kind: "finish" as const, reason: "The page is ready", summary: "Done" }
              : { kind: "blocked" as const, reason: "The requested content is no longer present" },
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
    expect(result.status).toBe(stillComplete ? "complete" : "blocked");
    expect(decisions).toBe(stillComplete ? VERIFIED_DECISIONS : REJECTED_DECISIONS);
    expect(steps[0]?.terminalObservation).toContain("after");
    expect(steps[0]?.terminalDecision?.action.kind).toBe(stillComplete ? "finish" : "blocked");
    if (stillComplete) {
      expect(steps[0]?.error).toBeUndefined();
      expect(steps).toHaveLength(1);
    } else {
      expect(steps[0]?.error).toContain("screen changed before Finish");
      expect(steps.at(-1)?.action.kind).toBe("blocked");
    }
  });
}

test("rejects a screen change during the fresh completion decision", async () => {
  let content = "first";
  let calls = 0;
  const computer = testComputer(() => content);
  const steps: TaskStep[] = [];
  const result = await runTask({
    task: "Read the requested content",
    preferredSurface: "browser",
    applications: [],
    computer: () => computer,
    decision: {
      async choose() {
        calls += 1;
        if (calls <= VERIFIED_DECISIONS) {
          content = calls === 1 ? "second" : "third";
          return {
            action: { kind: "finish", reason: "Content matched", summary: "Done" },
            latencyMs: 1,
            probabilities: { A0: 1 },
          };
        }
        return {
          action: { kind: "blocked", reason: "Requested content changed" },
          latencyMs: 1,
          probabilities: { A0: 1 },
        };
      },
    },
    text: { generate: async () => "" },
    onStep: (step) => {
      steps.push(step);
    },
  });
  expect(result.status).toBe("blocked");
  expect(steps[0]?.error).toContain("screen changed before Finish");
  expect(steps[0]?.terminalObservation).toContain("third");
});
