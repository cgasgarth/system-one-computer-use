import { createComputer, createModels, loadConfig } from "../../src/app/config.ts";
import { runTask } from "../../src/agent/loop.ts";
import { describeAction } from "../../src/agent/contracts.ts";
import type { TaskStep } from "../../src/agent/types.ts";
import { SessionStore } from "../../src/app/sessions/store.ts";
import { sessionContext } from "../../src/app/sessions/context.ts";
import { startWorkspace } from "./workspace.ts";
import { restrictedBrowser } from "./restricted-browser.ts";

const config = loadConfig();
const TASK_TIMEOUT_MS = 60_000;
const models = createModels(config);
const workspace = startWorkspace();
const reconnect = Bun.env["EVAL_RECONNECT"] === "1";
let browser = restrictedBrowser(createComputer(config, "browser"), workspace.origin);
const sessions = new SessionStore(`runs/qa/overnight/session-followup-${crypto.randomUUID()}`);
const traces: TaskStep[][] = [];
let failed = false;
try {
  await browser.desktop();
  const initial = await browser.window(0, 0);
  if (initial.url !== "about:blank") {
    throw new Error("The evaluation needs a blank task tab.");
  }
  await browser.navigate?.(`${workspace.origin}/`);
  const firstTask = "Open the Roadmap Review document.";
  const first = await sessions.begin(firstTask, { mode: "new" });
  const firstTrace: TaskStep[] = [];
  traces.push(firstTrace);
  const firstResult = await runTask({
    ...models,
    task: firstTask,
    context: sessionContext(first.session),
    preferredSurface: "browser",
    applications: [],
    signal: AbortSignal.timeout(TASK_TIMEOUT_MS),
    computer: () => browser,
    async onStep(step) {
      firstTrace.push(step);
      await sessions.update(first.handle, {
        action: describeAction(step.action),
        observation: step.observation,
      });
    },
  });
  await sessions.update(first.handle, {
    status: firstResult.status,
    message: firstResult.summary,
    ...(firstResult.surface === undefined ? {} : { surface: firstResult.surface }),
  });
  if (reconnect) {
    await browser.close();
    browser = restrictedBrowser(createComputer(config, "browser"), workspace.origin);
    await browser.desktop();
  }
  await browser.navigate?.(`${workspace.origin}/item/c-3`);
  const secondTask = "Open it again.";
  const second = await sessions.begin(secondTask, { mode: "resume", id: first.handle.sessionId });
  const secondTrace: TaskStep[] = [];
  traces.push(secondTrace);
  const secondResult = await runTask({
    ...models,
    task: secondTask,
    context: sessionContext(second.session),
    ...(second.session.surface === undefined ? {} : { previousSurface: second.session.surface }),
    preferredSurface: "browser",
    applications: [],
    signal: AbortSignal.timeout(TASK_TIMEOUT_MS),
    computer: () => browser,
    async onStep(step) {
      secondTrace.push(step);
      await sessions.update(second.handle, {
        action: describeAction(step.action),
        observation: step.observation,
      });
    },
  });
  await sessions.update(second.handle, {
    status: secondResult.status,
    message: secondResult.summary,
    ...(secondResult.surface === undefined ? {} : { surface: secondResult.surface }),
  });
  const final = await browser.window(0, 0);
  const passed =
    firstResult.status === "complete" &&
    firstResult.surface?.kind === "browser" &&
    secondResult.status === "complete" &&
    final.url?.startsWith(`${workspace.origin}/item/r-8`) === true &&
    workspace.saves() === 0;
  failed = !passed;
  const summary = {
    passed,
    firstStatus: firstResult.status,
    secondStatus: secondResult.status,
    firstSteps: firstTrace.length,
    secondSteps: secondTrace.length,
    savedSurface: second.session.surface,
    finalUrl: final.url,
    saves: workspace.saves(),
    reconnect,
  };
  console.log(JSON.stringify(summary));
  await Bun.write(
    `runs/qa/overnight/session-followup-${reconnect ? "reconnect" : "same-connection"}.json`,
    JSON.stringify({ ...summary, traces }),
    {
      createPath: true,
    },
  );
} finally {
  await browser.close();
  await workspace.close();
}
process.exitCode = Number(failed);
