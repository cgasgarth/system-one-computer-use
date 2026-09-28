import { createInterface } from "node:readline";
import { runTask } from "../agent/loop.ts";
import { ActionSelectionError } from "../models/action-selection-error.ts";
import { createComputer, createModels, installedApplications, loadConfig } from "./config.ts";
import { ComputerSessions } from "./computers.ts";
import type { TaskInput } from "./task-schema.ts";
import { consumeWorkerInput } from "./worker-input.ts";
import { SessionStore } from "./sessions/store.ts";
import { sessionContext } from "./sessions/context.ts";
import { WorkerExecution } from "./worker-execution.ts";

const config = loadConfig();
const models = createModels(config);
const sessions = new SessionStore();
const shutdown = new AbortController();
// eslint-disable-next-line eslint/init-declarations
let activeExecution: WorkerExecution | undefined;
const computers = new ComputerSessions((mode) =>
  createComputer(mode, {
    signal: shutdown.signal,
  }),
);
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
function endpointOrigin(value: string): string {
  const parsed = new URL(value);
  return parsed.protocol === "unix:" ? "unix://local" : parsed.origin;
}
const identities = {
  decision: {
    modelId: config.SYSTEM_ONE_MODEL,
    endpointOrigin: endpointOrigin(config.SYSTEM_ONE_URL),
  },
  text: { modelId: config.TEXT_MODEL_ID, endpointOrigin: endpointOrigin(config.TEXT_MODEL_URL) },
};
async function closeComputers(): Promise<void> {
  await computers.close();
}
async function stopComputers(): Promise<void> {
  try {
    await closeComputers();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Control cleanup failed");
  }
}
function stop(): void {
  activeExecution?.trace.saveFailure("stopped", "Stopped by user during an in-flight task.");
  shutdown.abort(new Error("Stopped by user"));
  input.close();
  void stopComputers();
}
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
async function executeTask(
  request: TaskInput,
  // Execution owns a mutable trace for this task.
  // eslint-disable-next-line typescript/prefer-readonly-parameter-types
  execution: Readonly<WorkerExecution>,
): Promise<void> {
  const { handle, session } = await sessions.begin(
    request.task,
    request.session,
    request.submittedAt ?? Date.now(),
  );
  execution.begin(request.task, handle);
  await execution.trace.captureSelection();
  console.log(
    JSON.stringify({ status: "running", message: "Choosing tools…", sessionId: session.id }),
  );
  const result = await runTask({
    decision: models.decision,
    text: execution.textModel(),
    computer: (mode) => computers.get(mode),
    applications: await installedApplications(),
    task: request.task,
    context: sessionContext(session),
    signal: shutdown.signal,
    ...(request.mode === "auto" ? {} : { preferredSurface: request.mode }),
    ...(session.surface === undefined ? {} : { previousSurface: session.surface }),
    onStage(event) {
      execution.stage(event);
    },
    onDecisionRequest(event) {
      execution.decisionRequest(event);
    },
    async onStep(step) {
      await execution.record(step);
    },
  });
  await sessions.update(handle, {
    status: result.status,
    message: result.summary,
    ...(result.surface === undefined ? {} : { surface: result.surface }),
  });
  await Bun.write(
    `runs/task-${Date.now()}.json`,
    JSON.stringify({ ...result, sessionId: session.id, activity: execution.trace.diagnostics() }),
    { createPath: true },
  );
  execution.report("Releasing computer control…");
  await computers.release();
  console.log(
    JSON.stringify({
      status: result.status,
      message: result.summary,
      decisions: execution.steps.length,
      modelRequests: execution.trace.requestCount,
      ...execution.trace.metrics(),
    }),
  );
  await execution.trace.clearCheckpoint();
}
async function execute(request: TaskInput): Promise<void> {
  const execution = new WorkerExecution({
    identities,
    sessions,
    text: models.text,
  });
  activeExecution = execution;
  try {
    await executeTask(request, execution);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Task failed";
    if (execution.handle !== undefined) {
      await sessions.update(execution.handle, {
        status: shutdown.signal.aborted ? "stopped" : "error",
        message,
      });
    }
    const status = shutdown.signal.aborted ? "stopped" : "error";
    execution.trace.saveFailure(
      status,
      message,
      error instanceof ActionSelectionError ? error.toJSON() : undefined,
    );
    await computers.release();
    const failure = {
      status: "error",
      message,
      task: execution.task,
      decisions: execution.steps.length,
      totalSeconds: execution.trace.totalSeconds(),
      modelRequests: execution.trace.requestCount,
      ...execution.trace.metrics(),
    };
    console.log(JSON.stringify(failure));
  } finally {
    await execution.trace.clearCheckpoint();
    activeExecution = undefined;
    await computers.release();
  }
}
try {
  await consumeWorkerInput(input, {
    run: execute,
    cancel() {
      shutdown.abort(new Error("Task input closed"));
    },
    busy() {
      console.error("A task is already running; the second request was not started.");
    },
    error(error) {
      console.error(error instanceof Error ? error.message : "Task failed");
    },
    stopped: () => shutdown.signal.aborted,
  });
} finally {
  await closeComputers();
}
