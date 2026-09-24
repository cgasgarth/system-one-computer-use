import { describeAction } from "./contracts.ts";
import { performStep } from "./execute.ts";
import { initialProgress } from "./progress.ts";
import type { TaskOptions, TaskResult, TaskStep } from "./types.ts";

const DEFAULT_STEPS = 16;
const MS_PER_SECOND = 1000;
interface Timing {
  readonly started: number;
  readonly textMs: number;
}

function completed(options: TaskOptions, steps: readonly TaskStep[], timing: Timing): TaskResult {
  const totalMs = performance.now() - timing.started;
  return {
    requestsPerSecond: steps.length / (totalMs / MS_PER_SECOND),
    steps,
    summary: options.task,
    task: options.task,
    textMs: timing.textMs,
    totalMs,
  };
}

async function runTask(options: TaskOptions): Promise<TaskResult> {
  const started = performance.now() - (options.preparationMs ?? 0);
  const plan = options.plan ?? (await options.text.prepare(options.task));
  const textMs = performance.now() - started;
  let progress = initialProgress();
  const steps: TaskStep[] = [];
  const maxSteps = options.maxSteps ?? DEFAULT_STEPS;
  for (let index = 0; index < maxSteps; index += 1) {
    const result = await performStep({ index, options, plan, progress, started });
    const { done, progress: nextProgress, step } = result;
    progress = nextProgress;
    steps.push(step);
    options.onStep?.(step);
    if (done) {
      return completed(options, steps, { started, textMs });
    }
  }
  const last = steps.at(-1);
  const description = last === undefined ? "none" : describeAction(last.action);
  throw new Error(`Task did not finish within ${maxSteps} decisions; last action: ${description}`);
}

export { runTask };
