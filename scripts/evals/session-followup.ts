import { createComputer, createModels, loadConfig } from "../../src/app/config.ts";
import { runTask } from "../../src/agent/loop.ts";
import { describeAction } from "../../src/agent/contracts.ts";
import type { TaskStep } from "../../src/agent/types.ts";
import { SessionStore } from "../../src/app/sessions/store.ts";
import { sessionContext } from "../../src/app/sessions/context.ts";
import { startWorkspace } from "./workspace.ts";
import { restrictedBrowser } from "./restricted-browser.ts";
import { fixtureHash, sourceHash } from "./provenance.ts";
import type { DecisionRequestEvent } from "../../src/models/decision-request.ts";

const config = loadConfig();
const TASK_TIMEOUT_MS = 60_000;
const runId = crypto.randomUUID();
const models = createModels(config);
const workspace = startWorkspace();
const reconnect = Bun.env["EVAL_RECONNECT"] === "1";
let browser = restrictedBrowser(createComputer("browser", {}), workspace.origin);
const sessions = new SessionStore(`runs/qa/overnight/session-followup-${runId}`);
const traces: TaskStep[][] = [];
const modelRequests: DecisionRequestEvent[][] = [];
const startedAt = new Date().toISOString();
const source = await sourceHash();
const fixture = await fixtureHash();
function writeCounts(): {
  readonly documents: number;
  readonly profiles: number;
  readonly projects: number;
  readonly choices: number;
  readonly duplicateChoices: number;
  readonly cancelledDrafts: number;
  readonly volatileClicks: number;
} {
  return {
    documents: workspace.saves(),
    profiles: workspace.profileSaves(),
    projects: workspace.projectSaves(),
    choices: workspace.choiceSaves(),
    duplicateChoices: workspace.duplicateSaves(),
    cancelledDrafts: workspace.cancelledDrafts().length,
    volatileClicks: workspace.volatileClicks(),
  };
}
let failed = false;
try {
  const beforeWrites = writeCounts();
  await browser.desktop();
  const initial = await browser.window(0, 0);
  if (initial.url !== "about:blank") {
    throw new Error("The evaluation needs a blank task tab.");
  }
  await browser.navigate?.(`${workspace.origin}/`);
  const firstTask = "Open the Roadmap Review document.";
  const first = await sessions.begin(firstTask, { mode: "new" });
  const firstTrace: TaskStep[] = [];
  const firstRequests: DecisionRequestEvent[] = [];
  traces.push(firstTrace);
  modelRequests.push(firstRequests);
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
    onDecisionRequest(event) {
      firstRequests.push(event);
    },
  });
  await sessions.update(first.handle, {
    status: firstResult.status,
    message: firstResult.summary,
    ...(firstResult.surface === undefined ? {} : { surface: firstResult.surface }),
  });
  if (reconnect) {
    await browser.close();
    browser = restrictedBrowser(createComputer("browser", {}), workspace.origin);
    await browser.desktop();
  }
  await browser.navigate?.(`${workspace.origin}/item/c-3`);
  const secondTask = "Open it again.";
  const second = await sessions.begin(secondTask, { mode: "resume", id: first.handle.sessionId });
  const secondTrace: TaskStep[] = [];
  const secondRequests: DecisionRequestEvent[] = [];
  traces.push(secondTrace);
  modelRequests.push(secondRequests);
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
    onDecisionRequest(event) {
      secondRequests.push(event);
    },
  });
  await sessions.update(second.handle, {
    status: secondResult.status,
    message: secondResult.summary,
    ...(secondResult.surface === undefined ? {} : { surface: secondResult.surface }),
  });
  const final = await browser.window(0, 0);
  const afterWrites = writeCounts();
  const writeDelta = {
    documents: afterWrites.documents - beforeWrites.documents,
    profiles: afterWrites.profiles - beforeWrites.profiles,
    projects: afterWrites.projects - beforeWrites.projects,
    choices: afterWrites.choices - beforeWrites.choices,
    duplicateChoices: afterWrites.duplicateChoices - beforeWrites.duplicateChoices,
    cancelledDrafts: afterWrites.cancelledDrafts - beforeWrites.cancelledDrafts,
    volatileClicks: afterWrites.volatileClicks - beforeWrites.volatileClicks,
  };
  const passed =
    firstResult.status === "complete" &&
    firstResult.surface?.kind === "browser" &&
    secondResult.status === "complete" &&
    final.url?.startsWith(`${workspace.origin}/item/r-8`) === true &&
    Object.values(writeDelta).every((count) => count === 0);
  failed = !passed;
  const summary = {
    runId,
    passed,
    firstStatus: firstResult.status,
    secondStatus: secondResult.status,
    firstSteps: firstTrace.length,
    secondSteps: secondTrace.length,
    savedSurface: second.session.surface,
    finalUrl: final.url,
    saves: workspace.saves(),
    writeDelta,
    modelRequestCount: modelRequests.map(
      (events) => events.filter((event) => event.status === "start").length,
    ),
    modelRequestMs: modelRequests.map((events) =>
      Math.round(
        events
          .filter((event) => event.status === "ok")
          .reduce((total, event) => total + (event.elapsedMs ?? 0), 0),
      ),
    ),
    reconnect,
  };
  console.log(JSON.stringify(summary));
  await Bun.write(
    `runs/qa/overnight/session-followup-${reconnect ? "reconnect" : "same-connection"}-${runId}.json`,
    JSON.stringify({
      ...summary,
      sourceHash: source,
      fixtureHash: fixture,
      requestedModel: config.SYSTEM_ONE_MODEL,
      startedAt,
      endedAt: new Date().toISOString(),
      beforeWrites,
      afterWrites,
      traces,
      modelRequests,
    }),
    {
      createPath: true,
    },
  );
} finally {
  await browser.close();
  await workspace.close();
}
process.exitCode = Number(failed);
