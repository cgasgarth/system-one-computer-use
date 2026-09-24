import { runTask } from "../agent/loop.ts";
import type { TaskResult, TaskStep } from "../agent/types.ts";
import { createComputer, createModels, loadConfig } from "./config.ts";
import { taskTextSchema } from "./task-schema.ts";

const ARGUMENT_OFFSET = 2;
const JSON_INDENT = 2;
const MS_PER_SECOND = 1000;
const config = loadConfig();
const models = createModels(config);
const computer = createComputer(config, config.CUA_MODE);
const task = taskTextSchema.parse(Bun.argv.slice(ARGUMENT_OFFSET).join(" "));

function trace(step: TaskStep): void {
  if (config.SYSTEM_ONE_TRACE === "1") {
    console.error(JSON.stringify(step));
  }
}

async function executeTask(): Promise<TaskResult> {
  try {
    return await runTask({
      ...models,
      computer,
      maxSteps: config.SYSTEM_ONE_MAX_STEPS,
      onStep: trace,
      task,
    });
  } finally {
    await computer.close();
  }
}

const result = await executeTask();
const tracePath = `runs/task-${new Date().toISOString().replaceAll(":", "-")}.json`;
await Bun.write(tracePath, JSON.stringify(result, undefined, JSON_INDENT), { createPath: true });
console.log(
  JSON.stringify({
    decisions: result.steps.length,
    requestsPerSecond: result.requestsPerSecond,
    summary: result.summary,
    totalSeconds: result.totalMs / MS_PER_SECOND,
    trace: tracePath,
  }),
);
