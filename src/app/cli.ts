import { runTask } from "../agent/loop.ts";
import { createComputer, createModels, installedApplications, loadConfig } from "./config.ts";
import { ComputerSessions } from "./computers.ts";
import { taskTextSchema } from "./task-schema.ts";
import { SessionStore } from "./sessions/store.ts";
import { sessionContext } from "./sessions/context.ts";
import { describeAction } from "../agent/contracts.ts";
import { ActionSelectionError } from "../models/action-selection-error.ts";
import type { TaskStep } from "../agent/types.ts";

const ARGUMENT_OFFSET = 2;
const config = loadConfig();
const models = createModels(config);
const sessions = new SessionStore("runs/sessions");
const task = taskTextSchema.parse(Bun.argv.slice(ARGUMENT_OFFSET).join(" "));
const { handle, session } = await sessions.begin(task);
const stopped = new AbortController();
process.once("SIGINT", () => {
  stopped.abort(new Error("Stopped by user"));
});
const computers = new ComputerSessions((mode) =>
  createComputer(mode, {
    signal: stopped.signal,
  }),
);
const steps: TaskStep[] = [];
try {
  const result = await runTask({
    ...models,
    computer: (mode) => computers.get(mode),
    task,
    context: sessionContext(session),
    applications: await installedApplications(),
    signal: stopped.signal,
    ...(config.SYSTEM_ONE_CONTROL_SURFACE === "auto"
      ? {}
      : { preferredSurface: config.SYSTEM_ONE_CONTROL_SURFACE }),
    ...(session.surface === undefined ? {} : { previousSurface: session.surface }),
    async onStep(step) {
      steps.push(step);
      await sessions.update(handle, {
        action: describeAction(step.action),
        observation: step.observation,
      });
      if (config.SYSTEM_ONE_TRACE === "1") {
        console.error(JSON.stringify(step));
      }
    },
  });
  await sessions.update(handle, {
    status: result.status,
    message: result.summary,
    ...(result.surface === undefined ? {} : { surface: result.surface }),
  });
  console.log(JSON.stringify(result));
} catch (error) {
  if (error instanceof ActionSelectionError) {
    await Bun.write(
      `runs/failed-cli-${Date.now()}.json`,
      JSON.stringify({ status: "error", task, steps, selectionFailure: error.toJSON() }),
      { createPath: true },
    );
  }
  await sessions.update(handle, {
    status: "error",
    message: error instanceof Error ? error.message : "Task failed",
  });
  throw error;
} finally {
  await computers.close();
}
