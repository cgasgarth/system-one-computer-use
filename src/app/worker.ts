import { createInterface } from "node:readline";
import { runTask } from "../agent/loop.ts";
import { describeAction } from "../agent/contracts.ts";
import { createComputer, createModels, loadConfig, resolveMode } from "./config.ts";
import type { ComputerMode, ManagedComputer } from "../computer/types.ts";
import { taskInputSchema } from "./task-schema.ts";

const MS_PER_SECOND = 1000;
const config = loadConfig();
const models = createModels(config);
const computers = new Map<ComputerMode, ManagedComputer>();
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });

function computerFor(mode: ComputerMode): ManagedComputer {
  const existing = computers.get(mode);
  if (existing !== undefined) {
    return existing;
  }
  const computer = createComputer(config, mode);
  computers.set(mode, computer);
  return computer;
}

async function execute(line: string): Promise<void> {
  try {
    const started = performance.now();
    let modelMs = 0;
    const task = taskInputSchema.parse(JSON.parse(line));
    console.log(JSON.stringify({ status: "running", message: "Planning task…" }));
    const plan = await models.text.prepare(task.task);
    const mode = await resolveMode({ mode: task.mode, task: task.task, model: models.text, plan });
    console.log(
      JSON.stringify({
        status: "running",
        message: mode === "browser" ? "Using Chrome" : "Using macOS",
      }),
    );
    const result = await runTask({
      ...models,
      plan,
      preparationMs: performance.now() - started,
      computer: computerFor(mode),
      maxSteps: config.SYSTEM_ONE_MAX_STEPS,
      task: task.task,
      onStep(step) {
        modelMs += step.decisionMs;
        const totalSeconds = (performance.now() - started) / MS_PER_SECOND;
        console.log(
          JSON.stringify({
            status: "running",
            message: step.error ?? describeAction(step.action),
            decisions: step.index,
            totalSeconds,
            requestsPerSecond: step.index / totalSeconds,
            modelMs: modelMs / step.index,
          }),
        );
      },
    });
    const trace = `runs/task-${new Date().toISOString().replaceAll(":", "-")}.json`;
    await Bun.write(trace, JSON.stringify(result), { createPath: true });
    console.log(
      JSON.stringify({
        status: "complete",
        message: result.summary,
        decisions: result.steps.length,
        requestsPerSecond: result.steps.length / ((performance.now() - started) / MS_PER_SECOND),
        totalSeconds: (performance.now() - started) / MS_PER_SECOND,
        modelMs: modelMs / result.steps.length,
      }),
    );
  } catch (error) {
    console.log(
      JSON.stringify({
        status: "error",
        message: error instanceof Error ? error.message : "Task failed",
      }),
    );
  }
}

try {
  for await (const line of input) {
    // Tasks must run in order because they share the user's computer.
    await execute(line);
  }
} finally {
  await Promise.all([...computers.values()].map(async (computer) => computer.close()));
}
