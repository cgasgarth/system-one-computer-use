import { taskLooksComplete } from "./completion.ts";
import { NoActionsError } from "./errors.ts";
import { appNameMatches } from "./app-name.ts";
import { validateActions } from "./contracts.ts";
import type { Action, ActionChoices, Observation, TaskPlan, Window } from "./contracts.ts";
import { attemptKey } from "./progress.ts";
import type { Progress } from "./types.ts";

const MAX_ACTIONS = 64;
const MAX_REASON_LENGTH = 280;
const EDITABLE_ROLES = new Set(["AXTextField", "AXTextArea", "textbox", "searchbox"]);
const CLICK_ACTIONS = new Set(["AXPress", "AXPick", "AXConfirm", "AXOpen"]);

interface CandidateContext {
  readonly canNavigate: boolean;
  readonly observation: Observation;
  readonly plan: TaskPlan;
  readonly progress: Progress;
  readonly task: string;
}

function desktopActions(plan: TaskPlan, observation: Observation): Action[] {
  const actions: Action[] = [];
  const windows = observation.desktop.windows.filter(
    (window) => plan.app === undefined || appNameMatches(window.app_name, plan.app),
  );
  if (plan.app !== undefined && windows.length === 0) {
    actions.push({
      kind: "launch_app",
      name: plan.app,
      reason: "Open the application named in the task",
    });
  }
  for (const window of windows) {
    actions.push({
      kind: "observe_window",
      pid: window.pid,
      window_id: window.window_id,
      reason: `Inspect ${window.app_name}: ${window.title}`,
    });
  }
  return actions;
}

function elementActions(
  element: Window["elements"][number],
  window: Window,
  plan: TaskPlan,
): Action[] {
  if (["AXStaticText", "statictext"].includes(element.role)) {
    return [];
  }
  const editable = EDITABLE_ROLES.has(element.role);
  const actions: Action[] = [];
  const target = {
    element_token: element.element_token,
    pid: window.pid,
    window_id: window.window_id,
  };
  if (!editable && (element.actions ?? []).some((name) => CLICK_ACTIONS.has(name))) {
    actions.push({
      ...target,
      kind: "click_element",
      reason:
        `Activate ${element.label ?? element.role}${element.href === undefined ? "" : ` (${element.href})`}`.slice(
          0,
          MAX_REASON_LENGTH,
        ),
    });
  }
  if (
    plan.textToEnter !== undefined &&
    element.value !== plan.textToEnter &&
    (editable || (element.actions ?? []).includes("AXSetValue"))
  ) {
    actions.push({
      ...target,
      kind: "type_text",
      text: plan.textToEnter,
      reason: `Enter requested text in ${element.label ?? element.role}`,
    });
  }
  return actions;
}

function navigationElements(
  window: Window,
  plan: TaskPlan,
  progress: Progress,
): Window["elements"] {
  if (plan.goal !== "open_website" || !progress.hasNavigated || window.url === undefined) {
    return window.elements;
  }
  // A website-opening task must not interact with the destination before verification.
  if (new URL(window.url).hostname !== "www.google.com") {
    return [];
  }
  const links = window.elements.filter(
    (element) =>
      element.role === "link" &&
      element.href !== undefined &&
      new URL(element.href).protocol === "https:" &&
      new URL(element.href).hostname !== "www.google.com",
  );
  const homepages = links.filter(
    (element) => element.href !== undefined && new URL(element.href).pathname === "/",
  );
  return homepages.length > 0 ? homepages : links;
}

function windowActions(window: Window, context: CandidateContext): Action[] {
  const { canNavigate, plan, progress } = context;
  const actions: Action[] = [];
  if (canNavigate && plan.url !== undefined && !progress.hasNavigated) {
    actions.push({
      kind: "navigate",
      reason:
        plan.goal === "open_website"
          ? `Find the official website for ${plan.website}`
          : "Open the URL in the task",
      url: plan.url,
    });
    return actions;
  }
  for (const element of navigationElements(window, plan, progress)) {
    actions.push(...elementActions(element, window, plan));
  }
  if (plan.goal === "enter_text") {
    const typing = actions.filter((action) => action.kind === "type_text");
    if (typing.length > 0) {
      return typing;
    }
  }
  if (
    plan.textToEnter !== undefined &&
    window.elements.some((element) => element.value === plan.textToEnter)
  ) {
    actions.push({
      key: "return",
      kind: "press_key",
      modifiers: [],
      pid: window.pid,
      reason: "Submit text if the field requires Return",
      window_id: window.window_id,
    });
  }
  return actions;
}

function candidates(context: CandidateContext): ActionChoices {
  const { observation, plan, progress, task } = context;
  const canFinish = taskLooksComplete(plan, observation, progress);
  const finish: Action = {
    kind: "finish",
    summary: task,
    reason: "The requested goal is satisfied in the current observation",
  };
  if (canFinish && plan.goal !== "task") {
    return [finish];
  }
  const actions =
    observation.window === undefined
      ? desktopActions(plan, observation)
      : windowActions(observation.window, context);
  const bounded = actions.slice(0, MAX_ACTIONS - Number(canFinish));
  if (canFinish) {
    bounded.push(finish);
  }
  const grounded = validateActions(bounded, observation).filter(
    (action) =>
      action.kind === "finish" || !progress.attempted.has(attemptKey(observation, action)),
  );
  const [first, ...rest] = grounded;
  if (first === undefined) {
    throw new NoActionsError();
  }
  return [first, ...rest];
}

export { candidates };
