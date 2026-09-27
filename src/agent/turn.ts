import type { Action, Observation } from "./contracts.ts";
import { describeAction } from "./contracts.ts";
import type { ActionResult, TaskOptions, TaskStep } from "./types.ts";
import type { Progress } from "./progress.ts";
import type { SurfaceSession } from "./surface.ts";
import { executeInput } from "./surface.ts";
import { enterText, openApplication, openUrl } from "./input.ts";
import { options as actionOptions } from "./options.ts";
import { summarizeObservation } from "../app/sessions/context.ts";
import { progressStateKey, stateKey } from "./state-key.ts";
import type { Decision, DecisionInput } from "../models/system-one.ts";

const HISTORY_CHARS = 2000;
const RECENT_STEPS = 6;
const ERROR_CHARS = 300;
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
function turnFeedback(lastError: string): string {
  return lastError.length === 0
    ? ""
    : `Last tool error: ${lastError.slice(0, ERROR_CHARS)}. Other tools remain available.`;
}
function selectedControl(action: Action, observation: Observation): TaskStep["control"] {
  if (action.kind !== "click_element") {
    return undefined;
  }
  const element = observation.window?.elements.find(
    (entry) => entry.element_token === action.element_token,
  );
  return { role: element?.role ?? "control", label: element?.label ?? "" };
}
async function verifyBrowserClick(context: TurnContext): Promise<void> {
  if (context.action.kind !== "click_element" || context.surfaces.mode !== "browser") {
    return;
  }
  const selected = context.observation.window;
  if (selected === undefined) {
    throw new Error("The browser target is no longer available. Observe it again.");
  }
  const fresh = await context.options
    .computer("browser")
    .window(context.action.pid, context.action.window_id);
  if (
    stateKey({ ...context.observation, window: fresh }) !== stateKey(context.observation) ||
    JSON.stringify(fresh.elements.map((element) => element.element_token)) !==
      JSON.stringify(selected.elements.map((element) => element.element_token))
  ) {
    throw new Error(
      "The browser changed before the click. Observe it again and choose a fresh target.",
    );
  }
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
  if (action.kind === "compose_text") {
    return enterText(input);
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
        output: `Opened ${opened.name}. Select an available window, observe again, or use another tool.`,
        performedAction: opened.unchanged === undefined,
        ...(opened.unchanged === undefined ? {} : { unchanged: opened.unchanged }),
      };
    }
    return opened.unchanged === undefined
      ? { output: `Opened ${opened.name}`, performedAction: true }
      : { output: `${opened.name} is already open and selected.`, unchanged: opened.unchanged };
  }
  await verifyBrowserClick({ options, surfaces, observation, action });
  options.signal?.throwIfAborted();
  await executeInput(computer, action, {
    observation,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  return { output: describeAction(action), performedAction: true };
}
async function selectSurface({ options, surfaces, action }: TurnContext): Promise<ActionResult> {
  if (action.kind !== "select_surface") {
    throw new Error("Expected a surface selection");
  }
  await surfaces.select(action.surface, options.computer(action.surface), options.previousSurface);
  return { output: `Selected ${action.surface} tools` };
}
async function act(context: TurnContext): Promise<ActionResult> {
  const { options, surfaces, observation, action } = context;
  if (action.kind === "select_surface") {
    return selectSurface(context);
  }
  if (action.kind === "observe_window") {
    if (surfaces.mode !== undefined) {
      await options.computer(surfaces.mode).focusWindow?.(action.pid, action.window_id);
    }
    surfaces.selectApplication(observation.desktop.apps.find((app) => app.pid === action.pid));
    surfaces.setTarget({ pid: action.pid, windowId: action.window_id });
    return { output: describeAction(action) };
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
function chooseInput(
  input: TurnInput,
  snapshot: {
    readonly observation: Observation;
    readonly lastError: string;
    readonly observationFailed: boolean;
  },
): DecisionInput {
  const { options, surfaces, history } = input;
  const { observation, lastError, observationFailed } = snapshot;
  const actions = input.progress.choices(
    actionOptions({
      task: options.task,
      ...(options.previousSurface === undefined
        ? {}
        : { previousSurface: options.previousSurface }),
      mode: surfaces.mode,
      needsApplication: surfaces.needsApplication && options.applications.length > 0,
      observation,
      observationFailed,
      applications: options.applications,
    }),
    observation,
  );
  const recentSteps = history
    .slice(-RECENT_STEPS)
    .map((step) => `${describeAction(step.action)} -> ${step.error ?? step.output ?? "No result"}`)
    .join("\n");
  const last = history.at(-1);
  const changedAfterError =
    last?.error !== undefined && last.observation !== summarizeObservation(observation)
      ? "The screen changed after the last tool reported an error. Its effect is uncertain, not necessarily absent. Check the current result before repeating the action."
      : "";
  const context = `${turnFeedback(lastError)}\n${changedAfterError}\n${input.progress.context(observation)}\nRecent actions and results:\n${recentSteps.slice(-HISTORY_CHARS)}`;
  const chosenComputer = surfaces.mode === undefined ? undefined : options.computer(surfaces.mode);
  const inspectClick = chosenComputer?.inspectClick.bind(chosenComputer);
  return {
    task: options.task,
    observation,
    actions,
    context: options.context?.slice(0, HISTORY_CHARS) ?? "",
    feedback: context,
    ...(inspectClick === undefined ? {} : { inspectClick }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.onDecisionRequest === undefined ? {} : { onRequest: options.onDecisionRequest }),
    mode: surfaces.mode,
  };
}
async function verifyFinishSurface(
  input: TurnInput,
  observation: Observation,
): Promise<{
  readonly error?: string;
  readonly observation?: Observation;
  readonly decision?: Decision;
}> {
  try {
    const fresh = await input.surfaces.observe(input.options.computer);
    input.options.signal?.throwIfAborted();
    if (progressStateKey(fresh) === progressStateKey(observation)) {
      return {};
    }
    const decision = await input.options.decision.choose(
      chooseInput(input, {
        observation: fresh,
        lastError: input.lastError,
        observationFailed: false,
      }),
    );
    input.options.signal?.throwIfAborted();
    const confirmed =
      decision.action.kind === "finish"
        ? await input.surfaces.observe(input.options.computer)
        : fresh;
    input.options.signal?.throwIfAborted();
    return {
      observation: confirmed,
      decision,
      ...(decision.action.kind === "finish" &&
      progressStateKey(confirmed) === progressStateKey(fresh)
        ? {}
        : {
            error:
              "The screen changed before Finish. The fresh result is not complete; choose the next action.",
          }),
    };
  } catch (error) {
    input.options.signal?.throwIfAborted();
    return {
      error: `Could not verify the screen before Finish: ${error instanceof Error ? error.message : "Observation failed"}`,
    };
  }
}
function nextError(step: TaskStep, lastError: string): string {
  const performed =
    step.performedAction === true &&
    step.action.kind !== "select_surface" &&
    step.action.kind !== "request_app";
  return step.error ?? (performed ? "" : lastError);
}
// Keep checkpoint writes immediately before each asynchronous turn stage.
// eslint-disable-next-line eslint/complexity, eslint/max-statements
async function performTurn(input: TurnInput): Promise<TurnResult> {
  const { options, surfaces, history } = input;
  options.signal?.throwIfAborted();
  await options.onStage?.({ stage: "observation", stepIndex: history.length + 1 });
  const observing = performance.now();
  const { observation, lastError, observationError } = await observe(input);
  const observationMs = performance.now() - observing;
  if (observationError === undefined) {
    input.progress.observe(observation);
  } else {
    input.progress.observeFailure(observationError);
  }
  await options.onStage?.({ stage: "decision", stepIndex: history.length + 1 });
  const decision = await options.decision.choose(
    chooseInput(input, {
      observation,
      lastError,
      observationFailed: observationError !== undefined,
    }),
  );
  options.signal?.throwIfAborted();
  await options.onStage?.({ stage: "action", stepIndex: history.length + 1 });
  options.signal?.throwIfAborted();
  const acting = performance.now();
  const finishSurface =
    decision.action.kind === "finish" ? await verifyFinishSurface(input, observation) : undefined;
  const result =
    finishSurface?.error === undefined
      ? await outcome({
          options,
          surfaces,
          observation,
          action: decision.action,
        })
      : { error: finishSurface.error };
  const control = selectedControl(decision.action, observation);
  const step: TaskStep = {
    action: decision.action,
    ...(control === undefined ? {} : { control }),
    decisionMs: decision.latencyMs + (finishSurface?.decision?.latencyMs ?? 0),
    observationMs,
    actionMs: Math.max(0, performance.now() - acting - (finishSurface?.decision?.latencyMs ?? 0)),
    elapsedMs: performance.now() - input.started,
    index: history.length + 1,
    probabilities: decision.probabilities,
    ...(decision.candidates === undefined ? {} : { candidates: decision.candidates }),
    ...(decision.operation === undefined ? {} : { operation: decision.operation }),
    ...(decision.rejectedOperations === undefined
      ? {}
      : { rejectedOperations: decision.rejectedOperations }),
    ...(decision.checks === undefined ? {} : { checks: decision.checks }),
    observation: summarizeObservation(observation),
    ...(finishSurface?.decision === undefined ? {} : { terminalDecision: finishSurface.decision }),
    ...(finishSurface?.observation === undefined
      ? {}
      : { terminalObservation: summarizeObservation(finishSurface.observation) }),
    ...(observationError === undefined ? {} : { observationError }),
    ...result,
  };
  input.progress.record(step.unchanged, step.satisfiedInput);
  input.progress.advanced(step.action, step.performedAction === true);
  if (observationError === undefined) {
    input.progress.attempted(step.action, observation);
  }
  return {
    step,
    observation: finishSurface?.observation ?? observation,
    lastError: nextError(step, lastError),
  };
}
export { performTurn };
