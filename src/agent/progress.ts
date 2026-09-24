import type { Action, Observation, TaskPlan } from "./contracts.ts";
import type { Progress } from "./types.ts";

interface UpdateContext {
  readonly action: Action;
  readonly observation: Observation;
  readonly plan: TaskPlan;
  readonly progress: Progress;
}

function initialProgress(): Progress {
  return {
    attempted: new Set<string>(),
    clickedTargetBeforeTitle: undefined,
    hasActed: false,
    hasNavigated: false,
    hasTaskAction: false,
    target: undefined,
  };
}

function attemptKey(observation: Observation, action: Action): string {
  const { window } = observation;
  const state =
    window === undefined
      ? "desktop"
      : JSON.stringify([
          window.window_title,
          window.elements.map((element) => [element.role, element.label, element.value]),
        ]);
  return `${state}|${action.kind}|${action.reason}`;
}

function markAttempt(progress: Progress, observation: Observation, action: Action): Progress {
  if (action.kind === "finish" || action.kind === "observe_window") {
    return progress;
  }
  const attempted = new Set([...progress.attempted, attemptKey(observation, action)]);
  return { ...progress, attempted };
}

function afterAction(context: UpdateContext): Progress {
  const { action, observation, plan, progress } = context;
  if (action.kind === "finish") {
    return progress;
  }
  if (action.kind === "observe_window") {
    return { ...progress, target: { pid: action.pid, windowId: action.window_id } };
  }
  if (action.kind === "launch_app") {
    return { ...progress, hasActed: true, target: undefined };
  }
  if (action.kind === "navigate") {
    return { ...progress, hasActed: true, hasNavigated: true };
  }
  const label = plan.targetLabel;
  if (
    action.kind === "click_element" &&
    label !== undefined &&
    action.reason.toLocaleLowerCase().includes(label.toLocaleLowerCase())
  ) {
    return {
      ...progress,
      clickedTargetBeforeTitle: observation.window?.window_title,
      hasActed: true,
      hasTaskAction: true,
    };
  }
  return { ...progress, hasActed: true, hasTaskAction: true };
}

export { afterAction, attemptKey, initialProgress, markAttempt };
