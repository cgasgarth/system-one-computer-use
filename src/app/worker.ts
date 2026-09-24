import { decisionMetrics } from "./decision-metrics.ts";
import { createInterface } from "node:readline";
import { runTask } from "../agent/loop.ts";
import { describeAction } from "../agent/contracts.ts";
import type { TaskPlan } from "../agent/contracts.ts";
import type { TaskStep } from "../agent/types.ts";
import { createComputer, createModels, loadConfig, resolveMode } from "./config.ts";
import type { ComputerMode, ManagedComputer } from "../computer/types.ts";
import { taskInputSchema } from "./task-schema.ts";
import type { TaskInput } from "./task-schema.ts";

const MS_PER_SECOND = 1000;
const config = loadConfig();
const models = createModels(config);
const computers = new Map<ComputerMode, ManagedComputer>();
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
const shutdown = new AbortController();

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

async function closeStoppedComputers(): Promise<void> {
  try {
    await closeComputers();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Driver shutdown failed");
  }
}

function stop(): void {
  shutdown.abort(new Error("Stopped by user"));
  input.close();
  void closeStoppedComputers();
}
process.once("SIGTERM", stop);
process.once("SIGINT", stop);

async function execute(line: string): Promise<void> {
  const started = performance.now();
  const steps: TaskStep[] = [];
  let task: TaskInput | undefined = undefined;
  let plan: TaskPlan | undefined = undefined;
  try {
    task = taskInputSchema.parse(JSON.parse(line));
    console.log(JSON.stringify({ status: "running", message: "Planning task…" }));
    plan = await models.text.prepare(task.task);
    const mode = await resolveMode({ mode: task.mode, task: task.task, model: models.text, plan });
    shutdown.signal.throwIfAborted();
    console.log(
      JSON.stringify({
        status: "running",
        message: mode === "browser" ? "Using Chrome" : "Using macOS",
      }),
    );
    const result = await runTask({
      ...models,
      plan,
      signal: shutdown.signal,
      preparationMs: performance.now() - started,
      computer: computerFor(mode),
      task: task.task,
      onStep(step) {
        steps.push(step);
        const totalSeconds = (performance.now() - started) / MS_PER_SECOND;
        console.log(
          JSON.stringify({
            status: "running",
            message: step.error ?? describeAction(step.action),
            decisions: step.index,
            totalSeconds,
            ...decisionMetrics(steps),
          }),
        );
      },
    });
    await Bun.write(
      `runs/task-${new Date().toISOString().replaceAll(":", "-")}.json`,
      JSON.stringify({ ...result, plan, status: "complete" }),
      {
        createPath: true,
      },
    );
    console.log(
      JSON.stringify({
        status: "complete",
        message: result.summary,
        decisions: steps.length,
        ...decisionMetrics(steps),
        totalSeconds: (performance.now() - started) / MS_PER_SECOND,
      }),
    );
  } catch (error) {
    const totalSeconds = (performance.now() - started) / MS_PER_SECOND;
    const failure = {
      status: "error",
      message: error instanceof Error ? error.message : "Task failed",
      totalSeconds,
      decisions: steps.length,
      ...decisionMetrics(steps),
    };
    const trace = `runs/failed-${new Date().toISOString().replaceAll(":", "-")}.json`;
    await Bun.write(trace, JSON.stringify({ ...failure, task: task?.task, plan, steps }), {
      createPath: true,
    });
    console.log(JSON.stringify(failure));
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
