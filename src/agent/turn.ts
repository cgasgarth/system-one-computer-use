import type { Action, Observation } from "./contracts.ts";
import { describeAction } from "./contracts.ts";
import type { ActionResult, TaskOptions, TaskStep } from "./types.ts";
import type { Progress } from "./progress.ts";
import type { SurfaceSession } from "./surface.ts";
import { executeInput } from "./surface.ts";
import { enterText, openApplication, openUrl } from "./input.ts";
import { options as actionOptions } from "./options.ts";
import { summarizeObservation } from "../app/sessions/context.ts";

const HISTORY_CHARS = 2000;
const RECENT_CHARS = 600;
const ERROR_CHARS = 300;
const RECENT_ACTIONS = 3;
const REFRESH_WAIT_MS = 250;
interface TurnContext {
  readonly options: TaskOptions;
  readonly surfaces: Readonly<SurfaceSession>;
  readonly observation: Observation;
  readonly action: Action;
}
interface TurnInput {
  readonly progress: Readonly<Progress>;
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
  const parts: string[] = [];
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
async function openFileChooser(context: TurnContext): Promise<ActionResult> {
  const { action, surfaces, observation } = context;
  if (action.kind !== "open_document" || surfaces.mode === undefined) {
    throw new Error("Select an application before using Open");
  }
  const computer = context.options.computer(surfaces.mode);
  if (computer.openDocument === undefined) {
    throw new Error("This driver cannot use application Open commands");
  }
  const existing = surfaces.documentTarget(action.pid, observation);
  if (existing !== undefined) {
    surfaces.setTarget(existing);
    return {
      output:
        "The window produced by Open is already available. Use its controls instead of opening it again.",
      unchanged: {
        kind: "document",
        applicationPid: action.pid,
        pid: existing.pid,
        windowId: existing.windowId,
      },
    };
  }
  const opened = await computer.openDocument({ name: action.name, pid: action.pid });
  if (opened !== undefined) {
    surfaces.rememberDocumentWindow(action.pid, opened);
  }
  return { output: `Requested ${action.name}'s Open command. Inspect the resulting file chooser.` };
}
async function applyInput({
  options,
  surfaces,
  observation,
  action,
}: TurnContext): Promise<ActionResult> {
  if (surfaces.mode === undefined) {
    throw new Error("Select a tool set first");
  }
  const computer = options.computer(surfaces.mode);
  const input = { action, observation, options, computer };
  if (action.kind === "open_document") {
    return openFileChooser({ options, surfaces, observation, action });
  }
  if (action.kind === "compose_text") {
    return { output: await enterText(input) };
  }
  if (action.kind === "request_url") {
    return openUrl(input);
  }
  if (action.kind === "request_app") {
    const opened = await openApplication(input);
    surfaces.selectApplication(opened.application);
    surfaces.setTarget(opened.target);
    if (opened.target === undefined) {
      return {
        output: `${opened.name} is running but no controllable window is available yet. Refresh, select another window, or use another tool.`,
        ...(opened.unchanged === undefined ? {} : { unchanged: opened.unchanged }),
      };
    }
    return opened.unchanged === undefined
      ? { output: `Opened ${opened.name}` }
      : { output: `${opened.name} is already open and selected.`, unchanged: opened.unchanged };
  }
  await executeInput(computer, action);
  return { output: describeAction(action) };
}
async function act({ options, surfaces, observation, action }: TurnContext): Promise<ActionResult> {
  if (action.kind === "select_surface") {
    await surfaces.select(
      action.surface,
      options.computer(action.surface),
      options.previousSurface,
    );
    return { output: `Selected ${action.surface} tools` };
  }
  if (action.kind === "observe_window") {
    if (surfaces.mode !== undefined) {
      await options.computer(surfaces.mode).focusWindow?.(action.pid, action.window_id);
    }
    surfaces.setTarget({ pid: action.pid, windowId: action.window_id });
    return { output: describeAction(action) };
  }
  if (action.kind === "request_window") {
    surfaces.chooseWindow();
    return { output: "Select the required window from the current window list." };
  }
  if (action.kind === "refresh") {
    await Bun.sleep(REFRESH_WAIT_MS);
    options.signal?.throwIfAborted();
    return { output: "Waiting for the observed state to change." };
  }
  if (action.kind === "finish" || action.kind === "blocked") {
    return { output: describeAction(action) };
  }
  return applyInput({ options, surfaces, observation, action });
}
async function observe(
  input: TurnInput,
): Promise<{ observation: Observation; lastError: string; observationError?: string }> {
  try {
    return {
      observation: await input.surfaces.observe(input.options.computer),
      lastError: input.lastError,
    };
  } catch (error) {
    input.surfaces.setTarget(undefined);
    const message = error instanceof Error ? error.message : "Observation failed";
    return {
      observation: { desktop: { apps: [], windows: [] } },
      lastError: message,
      observationError: message,
    };
  }
}
async function outcome(context: TurnContext): Promise<ActionResult | { readonly error: string }> {
  try {
    return await act(context);
  } catch (error) {
    context.options.signal?.throwIfAborted();
    return { error: error instanceof Error ? error.message : "Tool failed" };
  }
}
async function performTurn(input: TurnInput): Promise<TurnResult> {
  const { options, surfaces, history } = input;
  options.signal?.throwIfAborted();
  const observing = performance.now();
  const { observation, lastError, observationError } = await observe(input);
  const observationMs = performance.now() - observing;
  if (observationError === undefined) {
    input.progress.observe(observation);
  } else {
    input.progress.observeFailure(observationError);
  }
  const actions = input.progress.choices(
    actionOptions({
      mode: surfaces.mode,
      observation,
      observationFailed: observationError !== undefined,
      applications: options.applications,
      choosingWindow: surfaces.choosingWindow,
      canOpenDocument:
        surfaces.mode === "desktop" && options.computer("desktop").openDocument !== undefined,
    }),
    observation,
  );
  const context = `${turnContext(input, lastError)}\n${input.progress.context(observation)}`;
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
    options: {
      ...options,
      recentResults: history
        .slice(-RECENT_ACTIONS)
        .map((step) => step.output ?? step.error ?? step.action.reason),
    },
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
    ...(decision.completion === undefined ? {} : { completion: decision.completion }),
    observation: summarizeObservation(observation),
    ...(observationError === undefined ? {} : { observationError }),
    ...result,
  };
  input.progress.record(step.unchanged);
  if (observationError === undefined) {
    input.progress.attempted(step.action, observation);
  }
  const terminal =
    decision.action.kind === "finish" ||
    decision.action.kind === "blocked" ||
    decision.action.kind === "refresh";
  return { step, observation, lastError: step.error ?? (terminal ? lastError : "") };
}
export { performTurn };
