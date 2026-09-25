import type { Action, Observation } from "./contracts.ts";
import type { TaskOptions, TaskStep } from "./types.ts";
import type { SurfaceSession } from "./surface.ts";
import { executeInput } from "./surface.ts";
import { enterText, openApplication, openUrl } from "./input.ts";
import { options as actionOptions } from "./options.ts";
import { summarizeObservation } from "../app/sessions/context.ts";

const HISTORY_CHARS = 2000;
const RECENT_CHARS = 600;
const ERROR_CHARS = 300;
const RECENT_ACTIONS = 3;
interface TurnContext {
  readonly options: TaskOptions;
  readonly surfaces: Readonly<SurfaceSession>;
  readonly observation: Observation;
  readonly action: Action;
}
interface TurnInput {
  readonly options: TaskOptions;
  readonly surfaces: Readonly<SurfaceSession>;
  readonly history: readonly TaskStep[];
  readonly lastError: string;
  readonly started: number;
}
interface TurnResult {
  readonly step: TaskStep;
  readonly observation: Observation;
  readonly lastError: string;
}
function turnContext(input: TurnInput, lastError: string): string {
  const parts = [input.history.length === 0 ? "Task has just started." : "Task in progress."];
  if (input.options.context !== undefined && input.options.context.length > 0) {
    parts.push(input.options.context.slice(0, HISTORY_CHARS));
  }
  if (input.history.length > 0) {
    parts.push(
      `Recent tool results: ${input.history
        .slice(-RECENT_ACTIONS)
        .map((step) => step.output ?? step.error ?? step.action.reason)
        .join("; ")
        .slice(-RECENT_CHARS)}`,
    );
  }
  if (lastError.length > 0) {
    parts.push(
      `Last tool error: ${lastError.slice(0, ERROR_CHARS)}. Other tools remain available.`,
    );
  }
  return parts.join("\n");
}
async function applyInput({
  options,
  surfaces,
  observation,
  action,
}: TurnContext): Promise<string | undefined> {
  if (surfaces.mode === undefined) {
    throw new Error("Select a tool set first");
  }
  const computer = options.computer(surfaces.mode);
  const input = { action, observation, options, computer };
  if (action.kind === "compose_text") {
    return enterText(input);
  }
  if (action.kind === "request_url") {
    return openUrl(input);
  }
  if (action.kind === "request_app") {
    const opened = await openApplication(input);
    surfaces.setTarget(opened.target);
    return `Opened ${opened.name}`;
  }
  await executeInput(computer, action);
  if (action.kind === "launch_app") {
    surfaces.setTarget(undefined);
  }
  return undefined;
}
async function act({
  options,
  surfaces,
  observation,
  action,
}: TurnContext): Promise<string | undefined> {
  if (action.kind === "select_surface") {
    await surfaces.select(
      action.surface,
      options.computer(action.surface),
      options.previousSurface,
    );
    return `Selected ${action.surface} tools`;
  }
  if (action.kind === "observe_window") {
    surfaces.setTarget({ pid: action.pid, windowId: action.window_id });
    return undefined;
  }
  if (action.kind === "refresh" || action.kind === "finish" || action.kind === "blocked") {
    return undefined;
  }
  return applyInput({ options, surfaces, observation, action });
}
async function observe(input: TurnInput): Promise<{ observation: Observation; lastError: string }> {
  try {
    return {
      observation: await input.surfaces.observe(input.options.computer),
      lastError: input.lastError,
    };
  } catch (error) {
    input.surfaces.setTarget(undefined);
    return {
      observation: { desktop: { apps: [], windows: [] } },
      lastError: error instanceof Error ? error.message : "Observation failed",
    };
  }
}
async function outcome(context: TurnContext): Promise<{ output?: string; error?: string }> {
  try {
    const output = await act(context);
    return output === undefined ? {} : { output };
  } catch (error) {
    context.options.signal?.throwIfAborted();
    return { error: error instanceof Error ? error.message : "Tool failed" };
  }
}
async function performTurn(input: TurnInput): Promise<TurnResult> {
  const { options, surfaces, history } = input;
  options.signal?.throwIfAborted();
  const observing = performance.now();
  const { observation, lastError } = await observe(input);
  const observationMs = performance.now() - observing;
  const actions = actionOptions({
    mode: surfaces.mode,
    observation,
    applications: options.applications,
  });
  const context = turnContext(input, lastError);
  const decision = await options.decision.choose({
    task: options.task,
    observation,
    actions,
    context,
    mode: surfaces.mode,
  });
  options.signal?.throwIfAborted();
  const acting = performance.now();
  const result = await outcome({
    options: { ...options, context },
    surfaces,
    observation,
    action: decision.action,
  });
  const step: TaskStep = {
    action: decision.action,
    decisionMs: decision.latencyMs,
    observationMs,
    actionMs: performance.now() - acting,
    elapsedMs: performance.now() - input.started,
    index: history.length + 1,
    probabilities: decision.probabilities,
    observation: summarizeObservation(observation),
    ...result,
  };
  const terminal =
    decision.action.kind === "finish" ||
    decision.action.kind === "blocked" ||
    decision.action.kind === "refresh";
  return { step, observation, lastError: result.error ?? (terminal ? lastError : "") };
}
export { performTurn };
