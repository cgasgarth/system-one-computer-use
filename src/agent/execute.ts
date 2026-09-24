import { CuaError } from "../computer/errors.ts";
import type { Computer } from "../computer/types.ts";
import { candidates } from "./candidates.ts";
import type { Action, ActionChoices, Observation, TaskPlan } from "./contracts.ts";
import { NoActionsError } from "./errors.ts";
import { afterAction, markAttempt } from "./progress.ts";
import type { Progress, TaskOptions, TaskStep, WindowTarget } from "./types.ts";

interface StepContext {
  readonly index: number;
  readonly options: TaskOptions;
  readonly plan: TaskPlan;
  readonly progress: Progress;
  readonly started: number;
}
interface StepResult {
  readonly done: boolean;
  readonly progress: Progress;
  readonly step: TaskStep;
}
interface Observed {
  readonly observation: Observation;
  readonly target: WindowTarget | undefined;
}
interface ReadyObservation {
  readonly observation: Observation;
  readonly current: Progress;
  readonly actions: ActionChoices;
}
const OBSERVATION_RETRIES = 15;
const OBSERVATION_RETRY_MS = 100;

async function observe(computer: Computer, target: WindowTarget | undefined): Promise<Observed> {
  const desktop = await computer.desktop();
  if (
    target !== undefined &&
    desktop.windows.some(
      (window) => window.pid === target.pid && window.window_id === target.windowId,
    )
  ) {
    const window = await computer.window(target.pid, target.windowId);
    return { observation: { desktop, window }, target };
  }
  return { observation: { desktop }, target: undefined };
}

async function observeChoices(context: StepContext, retries: number): Promise<ReadyObservation> {
  context.options.signal?.throwIfAborted();
  const { options, plan } = context;
  const { observation, target } = await observe(options.computer, context.progress.target);
  const current = { ...context.progress, target };
  try {
    const actions = candidates({
      canNavigate: options.computer.navigate !== undefined,
      observation,
      plan,
      progress: current,
      task: options.task,
    });
    return { observation, current, actions };
  } catch (error) {
    if (!(error instanceof NoActionsError) || retries === 0 || !current.hasActed) {
      throw error;
    }
    await Bun.sleep(OBSERVATION_RETRY_MS);
    return observeChoices(context, retries - 1);
  }
}

async function execute(computer: Computer, action: Action): Promise<void> {
  switch (action.kind) {
    case "observe_window":
    case "finish": {
      return;
    }
    case "launch_app": {
      await computer.launchApp(action.name);
      return;
    }
    case "click_element": {
      await computer.clickElement(action);
      return;
    }
    case "type_text": {
      await computer.typeText(action);
      return;
    }
    case "press_key": {
      await computer.pressKey(action);
      return;
    }
    case "navigate": {
      if (computer.navigate === undefined) {
        throw new Error("Browser navigation is unavailable");
      }
      await computer.navigate(action.url);
    }
  }
}

async function performStep(context: StepContext): Promise<StepResult> {
  const { index, options, plan, started } = context;
  const observing = performance.now();
  const { observation, current, actions } = await observeChoices(context, OBSERVATION_RETRIES);
  const observationMs = performance.now() - observing;
  const choice = await options.decision.choose(options.task, observation, actions);
  options.signal?.throwIfAborted();
  let progress = markAttempt(current, observation, choice.action);
  let message: string | undefined = undefined;
  const executing = performance.now();
  try {
    await execute(options.computer, choice.action);
    progress = afterAction({ action: choice.action, observation, plan, progress });
  } catch (error) {
    if (!(error instanceof CuaError)) {
      throw error;
    }
    const { message: detail } = error;
    message = detail;
  }
  const step: TaskStep = {
    action: choice.action,
    decisionMs: choice.latencyMs,
    observationMs,
    actionMs: performance.now() - executing,
    elapsedMs: performance.now() - started,
    index: index + 1,
    probabilities: choice.probabilities,
    ...(message === undefined ? {} : { error: message }),
  };
  return { done: choice.action.kind === "finish" && message === undefined, progress, step };
}

export { performStep };
