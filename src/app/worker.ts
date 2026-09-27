import { createInterface } from "node:readline";
import { runTask } from "../agent/loop.ts";
import { ActionSelectionError } from "../models/action-selection-error.ts";
import { describeAction } from "../agent/contracts.ts";
import { createComputer, createModels, installedApplications, loadConfig } from "./config.ts";
import { ComputerSessions } from "./computers.ts";
import { taskInputSchema } from "./task-schema.ts";
import { SessionStore } from "./sessions/store.ts";
import type { TurnHandle } from "./sessions/store.ts";
import { sessionContext } from "./sessions/context.ts";
import { TaskTrace } from "./task-trace.ts";
import type { TraceModels } from "./task-trace.ts";

const config = loadConfig();
const models = createModels(config);
const sessions = new SessionStore();
const computers = new ComputerSessions((mode) => createComputer(config, mode));
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
const shutdown = new AbortController();
function endpointOrigin(value: string): string {
  const parsed = new URL(value);
  return parsed.protocol === "unix:" ? "unix://local" : parsed.origin;
}
const identities: TraceModels = {
  decision: {
    modelId: config.SYSTEM_ONE_MODEL,
    endpointOrigin: endpointOrigin(config.SYSTEM_ONE_URL),
  },
  text: { modelId: config.TEXT_MODEL_ID, endpointOrigin: endpointOrigin(config.TEXT_MODEL_URL) },
};
async function closeComputers(): Promise<void> {
  await computers.close();
}
async function closeNativeTask(): Promise<void> {
  await computers.closeDesktop();
}
// The worker has no active task until it receives the first request.
// eslint-disable-next-line eslint/init-declarations
let activeExecution: Execution | undefined;
function stop(): void {
  activeExecution?.trace.saveFailure("stopped", "Stopped by user during an in-flight task.");
  shutdown.abort(new Error("Stopped by user"));
  input.close();
  void closeComputers();
}
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
class Execution {
  public readonly trace = new TaskTrace(identities);
  private currentHandle: TurnHandle | undefined;
  public get steps(): TaskTrace["steps"] {
    return this.trace.steps;
  }
  public get handle(): TurnHandle | undefined {
    return this.currentHandle;
  }
  public get task(): string {
    return this.trace.taskText;
  }
  public begin(task: string, handle: TurnHandle): void {
    this.currentHandle = handle;
    this.trace.begin(task, handle.sessionId);
  }
  public async record(step: Parameters<TaskTrace["record"]>[0]): Promise<void> {
    this.trace.record(step);
    if (this.currentHandle === undefined) {
      throw new Error("The task session is unavailable while saving its step.");
    }
    await sessions.update(this.currentHandle, {
      action: describeAction(step.action),
      observation: step.observation,
      ...(step.output === undefined ? {} : { message: step.output }),
    });
    this.report(step.error ?? step.observationError ?? step.output ?? describeAction(step.action));
  }
  public report(message: string): void {
    console.log(
      JSON.stringify({
        status: "running",
        message,
        decisions: this.steps.length,
        modelRequests: this.trace.requestCount,
        ...this.trace.metrics(),
      }),
    );
  }
  public textModel(): typeof models.text {
    return {
      generate: async (request) => {
        const started = performance.now();
        this.trace.textRequest({ phase: request.purpose, status: "start" });
        this.report("Preparing requested text…");
        try {
          const value = await models.text.generate(request);
          this.trace.textRequest({
            phase: request.purpose,
            status: "ok",
            elapsedMs: performance.now() - started,
          });
          return value;
        } catch (error) {
          this.trace.textRequest({
            phase: request.purpose,
            status: "error",
            elapsedMs: performance.now() - started,
          });
          throw error;
        }
      },
    };
  }
  public stage(event: Parameters<TaskTrace["setStage"]>[0]): void {
    this.trace.setStage(event);
    const messages = {
      observation: "Inspecting screen…",
      decision: "Choosing the next action…",
      action: "Running selected action…",
    };
    this.report(messages[event.stage]);
  }
  public decisionRequest(event: Parameters<TaskTrace["modelRequest"]>[0]): void {
    this.trace.modelRequest(event);
    if (event.status !== "start") {
      return;
    }
    const checking =
      event.phase.startsWith("completion") ||
      event.phase.startsWith("commit") ||
      event.phase === "field-readiness";
    this.report(checking ? "Checking the current result…" : "Choosing the next action…");
  }
}
// Execution is the mutable task-local trace owner.
// eslint-disable-next-line typescript/prefer-readonly-parameter-types
async function executeTask(line: string, execution: Readonly<Execution>): Promise<void> {
  const request = taskInputSchema.parse(JSON.parse(line));
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
async function execute(line: string): Promise<void> {
  const execution = new Execution();
  activeExecution = execution;
  try {
    await executeTask(line, execution);
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
    await closeNativeTask();
  }
}
try {
  for await (const line of input) {
    if (shutdown.signal.aborted) {
      break;
    }
    await execute(line);
  }
} finally {
  await closeComputers();
}
