import { runTask } from "../agent/loop.ts";
import { createComputer, createModels, loadConfig } from "./config.ts";
import { installedApplications } from "../computer/applications.ts";
import type { ComputerMode, ManagedComputer } from "../computer/types.ts";
import { taskTextSchema } from "./task-schema.ts";
import { SessionStore } from "./sessions/store.ts";
import { sessionContext } from "./sessions/context.ts";
import { describeAction } from "../agent/contracts.ts";

const ARGUMENT_OFFSET = 2;
const config = loadConfig();
const models = createModels(config);
const sessions = new SessionStore("runs/sessions");
const task = taskTextSchema.parse(Bun.argv.slice(ARGUMENT_OFFSET).join(" "));
const { handle, session } = await sessions.begin(task);
const computers = new Map<ComputerMode, ManagedComputer>();
function computer(mode: ComputerMode): ManagedComputer {
  const existing = computers.get(mode);
  if (existing !== undefined) {
    return existing;
  }
  const created = createComputer(config, mode);
  computers.set(mode, created);
  return created;
}
try {
  const result = await runTask({
    ...models,
    computer,
    task,
    context: sessionContext(session),
    applications: await installedApplications(),
    ...(config.CUA_MODE === "auto" ? {} : { preferredSurface: config.CUA_MODE }),
    ...(session.surface === undefined ? {} : { previousSurface: session.surface }),
    async onStep(step) {
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
  await sessions.update(handle, {
    status: "error",
    message: error instanceof Error ? error.message : "Task failed",
  });
  throw error;
} finally {
  await Promise.all([...computers.values()].map(async (driver) => driver.close()));
}
