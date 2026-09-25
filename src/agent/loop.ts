import type { Observation } from "./contracts.ts";
import type { TaskOptions, TaskResult, TaskStep } from "./types.ts";
import type { Surface } from "../app/sessions/schema.ts";
import { SurfaceSession } from "./surface.ts";
import { performTurn } from "./turn.ts";
import { Progress } from "./progress.ts";

const MS_PER_SECOND = 1000;
async function bookmark(
  options: TaskOptions,
  surfaces: Readonly<SurfaceSession>,
  observation: Observation,
): Promise<Surface | undefined> {
  if (surfaces.mode === "browser") {
    return options.computer("browser").bookmark?.();
  }
  const { window } = observation;
  return window === undefined
    ? undefined
    : {
        kind: "desktop",
        pid: window.pid,
        windowId: window.window_id,
        app: window.app_name,
        title: window.window_title,
      };
}
interface FinishContext {
  readonly options: TaskOptions;
  readonly surfaces: Readonly<SurfaceSession>;
  readonly observation: Observation;
  readonly steps: readonly TaskStep[];
  readonly started: number;
  readonly lastError: string;
  readonly complete: boolean;
}
function blockedSummary(context: FinishContext): string {
  if (context.lastError.length > 0) {
    return context.lastError;
  }
  if (context.observation.application !== undefined && context.observation.window === undefined) {
    return `${context.observation.application.name} is running but has no controllable window. Open a document or window in that app, then continue this session.`;
  }
  return "The model marked this task as blocked.";
}
async function finish(context: FinishContext): Promise<TaskResult> {
  const totalMs = performance.now() - context.started;
  let surface: Surface | undefined = undefined;
  try {
    surface = await bookmark(context.options, context.surfaces, context.observation);
  } catch {
    /* A closed surface is not saved as a usable target. */
  }
  return {
    status: context.complete ? "complete" : "blocked",
    task: context.options.task,
    summary: context.complete ? "Task marked complete" : blockedSummary(context),
    steps: context.steps,
    totalMs,
    requestsPerSecond: context.steps.length / (totalMs / MS_PER_SECOND),
    ...(surface === undefined ? {} : { surface }),
  };
}
async function runTask(options: TaskOptions): Promise<TaskResult> {
  const started = performance.now();
  const steps: TaskStep[] = [];
  const surfaces = new SurfaceSession();
  const progress = new Progress();
  let lastError = "";
  if (options.preferredSurface !== undefined) {
    try {
      await surfaces.select(
        options.preferredSurface,
        options.computer(options.preferredSurface),
        options.previousSurface,
      );
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Could not restore the selected surface";
    }
  }
  for (;;) {
    const result = await performTurn({
      options,
      surfaces,
      progress,
      history: steps,
      lastError,
      started,
    });
    ({ lastError } = result);
    steps.push(result.step);
    await options.onStep?.(result.step);
    const { kind } = result.step.action;
    if (kind === "finish" || kind === "blocked") {
      return finish({
        options,
        surfaces,
        observation: result.observation,
        steps,
        started,
        lastError,
        complete: kind === "finish",
      });
    }
  }
}
export { runTask };
