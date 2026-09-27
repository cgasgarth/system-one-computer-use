import { describeAction, isEditableElement } from "../agent/contracts.ts";
import type { Action, Observation, Window } from "../agent/contracts.ts";
import { relevantControls, textTargetName } from "../agent/controls.ts";
import { observedTargetName, targetDescriptionContext } from "../agent/target-context.ts";
import type { ActionCriteria, DecisionAnswer } from "./system-one-schema.ts";
import type { DecisionInput } from "./system-one.ts";

const MAX_CONTROLS = 100;
const LONG_LIST_PRIMARY_CONTROLS = 35;
const LONG_LIST_SUMMARY_CHARS = 3000;
const LONG_LIST_HALVES = 2;
const LONG_LIST_HALF_CHARS = LONG_LIST_SUMMARY_CHARS / LONG_LIST_HALVES;
const MAX_FIELD_CHARS = 100;
const MAX_STATE_CHARS = 6000;
const MIN_STATE_CHARS = 1200;
const CLICK_VERBS = {
  press: "Activate",
  pick: "Pick",
  confirm: "Confirm",
  open: "Open",
} as const;
const MAX_URL_CHARS = 180;
const MAX_GROUP_URLS = 6;

type ActionGroupKind = Action["kind"] | "visible_controls" | "application_menu";
interface ActionGroup {
  readonly kind: ActionGroupKind;
  readonly description: string;
  readonly actions: readonly Action[];
}
interface OperationDecision {
  readonly options: readonly string[];
  readonly answer: DecisionAnswer;
}
const DESCRIPTIONS: Readonly<Record<Action["kind"], string>> = {
  click_element: "Click a button or open an existing link.",
  compose_text: "Enter or replace text in an editable field.",
  type_text: "Enter supplied text in an editable field.",
  request_url: "Navigate to a URL.",
  navigate: "Navigate to a supplied URL.",
  select_surface: "Switch between Chrome and Mac application tools.",
  press_key: "Use the keyboard for the focused control.",
  refresh: "Wait for the current page to update.",
  finish: "The requested result is complete. Stop.",
  blocked: "Required input or access is missing. Stop.",
  request_app: "Open an installed application.",
  observe_window: "Select a different open window.",
  invoke_menu: "Choose an enabled command from the selected application's observed menu.",
};
const GROUP_DESCRIPTIONS: Readonly<Record<ActionGroupKind, string>> = {
  ...DESCRIPTIONS,
  visible_controls:
    "Use a visible control in this window, including search and text fields, rows, and buttons.",
  application_menu: "Use an observed command in this application's menu.",
};
function groupKind(action: Action): ActionGroupKind {
  if (
    action.kind === "click_element" ||
    action.kind === "compose_text" ||
    action.kind === "press_key" ||
    action.kind === "type_text"
  ) {
    return "visible_controls";
  }
  return action.kind === "invoke_menu" ? "application_menu" : action.kind;
}
function actionGroups(actions: readonly Action[]): readonly ActionGroup[] {
  const grouped = new Map<ActionGroupKind, Action[]>();
  for (const action of actions) {
    const key = groupKind(action);
    const group = grouped.get(key) ?? [];
    group.push(action);
    grouped.set(key, group);
  }
  return [...grouped].map(([kind, group]) => ({
    kind,
    description:
      kind === "navigate"
        ? `Navigate to a supplied URL: ${group
            .filter(
              (action): action is Extract<Action, { kind: "navigate" }> =>
                action.kind === "navigate",
            )
            .slice(0, MAX_GROUP_URLS)
            .map(
              (action) =>
                `${action.url.slice(0, MAX_URL_CHARS)} (${action.reason.slice(0, MAX_URL_CHARS)})`,
            )
            .join(
              " | ",
            )}${group.length > MAX_GROUP_URLS ? ` | and ${group.length - MAX_GROUP_URLS} more` : ""}.`
        : GROUP_DESCRIPTIONS[kind],
    actions: group,
  }));
}
function actionDescription(action: Action, observation: Observation): string {
  if (action.kind !== "click_element" && action.kind !== "compose_text") {
    return describeAction(action);
  }
  const { window } = observation;
  const target = window?.elements.find((element) => element.element_token === action.element_token);
  if (window === undefined || target === undefined) {
    return describeAction(action);
  }
  const observed = observedTargetName(target);
  if (observed === undefined && action.kind === "click_element") {
    return action.reason;
  }
  const label =
    action.kind === "compose_text" ? textTargetName(target) : (observed ?? textTargetName(target));
  const verb =
    action.kind === "compose_text" ? "Enter text in" : CLICK_VERBS[action.operation ?? "press"];
  return `${verb} ${target.role} ${JSON.stringify(label)}${targetDescriptionContext(target, window)}.`;
}

function describeControl(element: Window["elements"][number]): string {
  let value = "";
  if (element.value !== undefined && element.value !== null) {
    value = String(element.value);
  }
  if (isEditableElement(element)) {
    const kind =
      element.role === "searchbox" || element.subrole === "AXSearchField"
        ? "search field"
        : "text field";
    return `Editable ${kind} ${JSON.stringify(textTargetName(element))}: current text ${JSON.stringify(value.slice(0, MAX_FIELD_CHARS))}`;
  }
  const flags = [
    element.enabled === false ? "disabled" : "",
    element.selected === true ? "selected" : "",
    element.focused === true ? "focused" : "",
  ]
    .filter(Boolean)
    .join(", ");
  return `${element.role} ${element.label?.slice(0, MAX_FIELD_CHARS) ?? ""} ${value.slice(0, MAX_FIELD_CHARS)}${flags.length === 0 ? "" : ` (${flags})`}`;
}

function describeObservation(observation: Observation, contextLength: number): string {
  const windows = observation.desktop.windows
    .map((window) => `${window.app_name}: ${window.title}`)
    .join(" | ");
  const current = observation.window;
  if (current === undefined) {
    if (observation.application !== undefined) {
      const available = observation.desktop.windows.some(
        (window) => window.pid === observation.application?.pid,
      );
      return `Selected application: ${observation.application.name}. ${available ? "Choose one of its available windows." : "It is running without a controllable window."}\nAvailable windows: ${windows}`;
    }
    return `Windows: ${windows}\nNo window selected.`;
  }
  const allControls = relevantControls(current);
  const controls = allControls
    .slice(0, allControls.length > MAX_CONTROLS ? LONG_LIST_PRIMARY_CONTROLS : MAX_CONTROLS)
    .map((element) => describeControl(element))
    .join("\n");
  const remaining =
    allControls.length > MAX_CONTROLS ? allControls.slice(LONG_LIST_PRIMARY_CONTROLS) : [];
  const laterControls = remaining
    .filter((element) => (element.actions ?? []).length > 0)
    .map((element) => `${element.role} ${JSON.stringify(element.label ?? "")}`)
    .join(" | ");
  const laterSummary =
    laterControls.length <= LONG_LIST_SUMMARY_CHARS
      ? laterControls
      : `${laterControls.slice(0, LONG_LIST_HALF_CHARS)} ... ${laterControls.slice(-LONG_LIST_HALF_CHARS)}`;
  const lines = [
    `Current window: ${current.app_name}: ${current.window_title}`,
    ...(current.url === undefined ? [] : [`Current URL: ${current.url}`]),
    `Visible controls and values: ${controls.slice(0, Math.max(MIN_STATE_CHARS, MAX_STATE_CHARS - contextLength))}`,
    ...(remaining.length === 0
      ? []
      : [`Further actionable controls (${remaining.length} later rows): ${laterSummary}`]),
  ];
  return lines.join("\n");
}

function decisionState(input: DecisionInput): string {
  const state = [`User request: ${input.task}`];
  if (input.context !== undefined && input.context.length > 0) {
    state.push(input.context);
  }
  if (input.feedback !== undefined && input.feedback.length > 0) {
    state.push(input.feedback);
  }
  if (input.mode === undefined) {
    state.push(
      "No tool set selected yet. Both Chrome and Mac desktop tools are available.",
      `Running applications: ${input.observation.desktop.apps.map((app) => app.name).join(", ")}.`,
    );
  } else {
    state.push(
      `Selected tool set: ${input.mode}. You can switch to the other tool set.`,
      describeObservation(input.observation, input.context?.length ?? 0),
    );
  }
  return state.join("\n");
}

function criteriaFor(descriptions: readonly string[]): ActionCriteria {
  const criteria: ActionCriteria = {};
  for (const [index, description] of descriptions.entries()) {
    criteria[`A${index}`] = description;
  }
  return criteria;
}

export {
  actionDescription,
  actionGroups,
  criteriaFor,
  decisionState,
  describeControl,
  MAX_STATE_CHARS,
};
export type { OperationDecision };
