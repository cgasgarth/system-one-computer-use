import { expect, test } from "bun:test";
import { actionSchema } from "../src/agent/contracts.ts";
import type { Desktop } from "../src/agent/contracts.ts";
import { options } from "../src/agent/options.ts";
import { runTask } from "../src/agent/loop.ts";
import { computerFixture } from "./fixtures.ts";

test("the decision model chooses an exact installed app after desktop selection", async () => {
  const { computer: base } = computerFixture();
  const launches: string[] = [];
  const selected: string[] = [];
  let textCalls = 0;
  const computer = {
    ...base,
    async desktop(): Promise<Desktop> {
      return {
        apps: [
          { name: "ChatGPT", pid: 2 },
          { name: "Messages", pid: 7 },
        ],
        windows: [{ app_name: "Messages", pid: 7, window_id: 9, title: "Messages" }],
      };
    },
    async launchApp(name: string): Promise<void> {
      launches.push(name);
    },
  };
  const result = await runTask({
    task: "Open my recent text conversation",
    context: "Previous request (historical only): Open ChatGPT",
    applications: ["ChatGPT", "Messages"],
    computer: () => computer,
    text: {
      async generate() {
        textCalls += 1;
        return "ChatGPT";
      },
    },
    decision: {
      async choose(input) {
        if (input.mode === undefined) {
          const action = input.actions.find(
            (candidate) => candidate.kind === "select_surface" && candidate.surface === "desktop",
          );
          if (action === undefined) {
            throw new Error("Desktop action unavailable");
          }
          return { action, latencyMs: 1, probabilities: { A0: 1 } };
        }
        if (input.observation.window === undefined) {
          const action = input.actions.find(
            (candidate) => candidate.kind === "request_app" && candidate.name === "Messages",
          );
          if (action?.kind !== "request_app") {
            throw new Error("Messages action unavailable");
          }
          selected.push(action.name);
          return { action, latencyMs: 1, probabilities: { A0: 1 } };
        }
        const action = input.actions.find((candidate) => candidate.kind === "finish");
        if (action === undefined) {
          throw new Error("Finish unavailable");
        }
        return { action, latencyMs: 1, probabilities: { A0: 1 } };
      },
    },
  });
  expect(result.status).toBe("complete");
  expect(result.steps.map((step) => step.action.kind)).toEqual([
    "select_surface",
    "request_app",
    "finish",
  ]);
  expect(selected).toEqual(["Messages"]);
  expect(launches).toEqual(["Messages"]);
  expect(textCalls).toBe(0);
});

test("app options are exact and require a name at the action boundary", () => {
  const actions = options({
    mode: "desktop",
    needsApplication: true,
    observation: { desktop: { apps: [], windows: [] } },
    applications: ["ChatGPT", "Messages"],
  });
  expect(
    actions.filter((action) => action.kind === "request_app").map((action) => action.name),
  ).toEqual(["ChatGPT", "Messages"]);
  expect(actionSchema.safeParse({ kind: "request_app", reason: "Open an app" }).success).toBe(
    false,
  );
});
