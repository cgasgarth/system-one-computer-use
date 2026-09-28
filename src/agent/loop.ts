import { z } from "zod";
import type { Observation, Surface } from "./contracts.ts";
import type { TaskOptions, TaskResult, TaskStep } from "./types.ts";
import type { ComputerMode } from "../computer/types.ts";
import { SurfaceSession } from "./surface.ts";
import { performTurn } from "./turn.ts";
import { Progress } from "./progress.ts";

const validationIssues = z.array(z.object({ message: z.string() })).nonempty();
function initialSurface(options: Readonly<TaskOptions>): ComputerMode | undefined {
  const available = options.availableSurfaces ?? (["browser", "desktop"] as const);
  if (options.preferredSurface !== undefined && !available.includes(options.preferredSurface)) {
    throw new Error("The preferred tool surface is unavailable in this run.");
  }
  return options.preferredSurface ?? (available.length === 1 ? available[0] : undefined);
}
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
    try {
      const issues = validationIssues.safeParse(JSON.parse(context.lastError));
      if (issues.success) {
        return `A tool input was invalid: ${issues.data[0]?.message ?? "Invalid input"}. Check the input and try again.`;
      }
    } catch {
      // Ordinary errors are already readable.
    }
    return context.lastError;
  }
  if (
    context.observation.application !== undefined &&
    context.observation.window === undefined &&
    !context.observation.desktop.windows.some(
      (window) => window.pid === context.observation.application?.pid,
    )
  ) {
    return `${context.observation.application.name} is running but has no controllable window. Open a document or window in that app, then continue this session.`;
  }
  if (context.steps.every((step) => step.action.kind === "blocked")) {
    return "The model stopped before taking an action.";
  }
  const app = context.observation.window?.app_name;
  return app === undefined
    ? "The model stopped before completing the task."
    : `The model stopped in ${app} before completing the task.`;
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
    ...(surface === undefined ? {} : { surface }),
  };
}
async function runTask(options: TaskOptions): Promise<TaskResult> {
  const initial = initialSurface(options);
  const started = performance.now();
  const steps: TaskStep[] = [];
  const surfaces = new SurfaceSession();
  const progress = new Progress();
  let lastError = "";
  if (initial !== undefined) {
    try {
      await surfaces.select(
        initial,
        options.computer(initial),
        options.previousSurface?.kind === initial ? options.previousSurface : undefined,
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
    if ((kind === "finish" && result.step.error === undefined) || kind === "blocked") {
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
