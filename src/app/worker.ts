import { createInterface } from "node:readline";
import { runTask } from "../agent/loop.ts";
import { describeAction } from "../agent/contracts.ts";
import type { TaskStep } from "../agent/types.ts";
import { createComputer, createModels, installedApplications, loadConfig } from "./config.ts";
import type { ComputerMode, ManagedComputer } from "../computer/types.ts";
import { taskInputSchema } from "./task-schema.ts";
import { SessionStore } from "./sessions/store.ts";
import type { TurnHandle } from "./sessions/store.ts";
import { sessionContext } from "./sessions/context.ts";
import { decisionMetrics } from "./decision-metrics.ts";

const config = loadConfig();
const models = createModels(config);
const sessions = new SessionStore();
const computers = new Map<ComputerMode, ManagedComputer>();
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
const shutdown = new AbortController();
const MS_PER_SECOND = 1000;
function computerFor(mode: ComputerMode): ManagedComputer {
  const existing = computers.get(mode);
  if (existing !== undefined) {
    return existing;
  }
  const computer = createComputer(config, mode);
  computers.set(mode, computer);
  return computer;
}
async function closeComputers(): Promise<void> {
  const current = [...computers.values()];
  computers.clear();
  await Promise.all(current.map(async (computer) => computer.close()));
}
async function closeNativeTask(): Promise<void> {
  const native = computers.get("desktop");
  computers.delete("desktop");
  await native?.close();
}
function stop(): void {
  shutdown.abort(new Error("Stopped by user"));
  input.close();
  void closeComputers();
}
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
class Execution {
  public readonly started = performance.now();
  private readonly recorded: TaskStep[] = [];
  private currentHandle: TurnHandle | undefined;
  private currentTask = "";
  public get steps(): readonly TaskStep[] {
    return this.recorded;
  }
  public get handle(): TurnHandle | undefined {
    return this.currentHandle;
  }
  public get task(): string {
    return this.currentTask;
  }
  public begin(task: string, handle: TurnHandle): void {
    this.currentTask = task;
    this.currentHandle = handle;
  }
  public record(step: TaskStep): void {
    this.recorded.push(step);
  }
}
async function executeTask(line: string, execution: Readonly<Execution>): Promise<void> {
  const request = taskInputSchema.parse(JSON.parse(line));
  const { handle, session } = await sessions.begin(
    request.task,
    request.session,
    request.submittedAt ?? Date.now(),
  );
  execution.begin(request.task, handle);
  console.log(
    JSON.stringify({ status: "running", message: "Choosing tools…", sessionId: session.id }),
  );
  const result = await runTask({
    ...models,
    computer: computerFor,
    applications: await installedApplications(),
    task: request.task,
    context: sessionContext(session),
    signal: shutdown.signal,
    ...(request.mode === "auto" ? {} : { preferredSurface: request.mode }),
    ...(session.surface === undefined ? {} : { previousSurface: session.surface }),
    async onStep(step) {
      execution.record(step);
      await sessions.update(handle, {
        action: describeAction(step.action),
        observation: step.observation,
        ...(step.output === undefined ? {} : { message: step.output }),
      });
      console.log(
        JSON.stringify({
          status: "running",
          message:
            step.error ?? step.observationError ?? step.output ?? describeAction(step.action),
          decisions: step.index,
          ...decisionMetrics(execution.steps),
        }),
      );
    },
  });
  await sessions.update(handle, {
    status: result.status,
    message: result.summary,
    ...(result.surface === undefined ? {} : { surface: result.surface }),
  });
  await Bun.write(
    `runs/task-${Date.now()}.json`,
    JSON.stringify({ ...result, sessionId: session.id }),
    { createPath: true },
  );
  console.log(
    JSON.stringify({
      status: result.status,
      message: result.summary,
      decisions: execution.steps.length,
      ...decisionMetrics(execution.steps),
    }),
  );
}
async function execute(line: string): Promise<void> {
  const execution = new Execution();
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
    const failure = {
      status: "error",
      message,
      task: execution.task,
      decisions: execution.steps.length,
      totalSeconds: (performance.now() - execution.started) / MS_PER_SECOND,
      ...decisionMetrics(execution.steps),
    };
    await Bun.write(
      `runs/failed-${Date.now()}.json`,
      JSON.stringify({ ...failure, steps: execution.steps }),
      { createPath: true },
    );
    console.log(JSON.stringify(failure));
  } finally {
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
