import { describeAction, isEditableElement } from "../agent/contracts.ts";
import type { Action, Observation, Window } from "../agent/contracts.ts";
import { relevantControls, textTargetName } from "../agent/controls.ts";
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

interface ActionGroup {
  readonly kind: Action["kind"];
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
function actionGroups(actions: readonly Action[]): readonly ActionGroup[] {
  const grouped = new Map<string, Action[]>();
  for (const action of actions) {
    const key = action.kind === "invoke_menu" ? `${action.kind}:${action.path[0]}` : action.kind;
    const group = grouped.get(key) ?? [];
    group.push(action);
    grouped.set(key, group);
  }
  return [...grouped.values()].map((group) => {
    const [first] = group;
    if (first === undefined) {
      throw new Error("Empty operation group");
    }
    return {
      kind: first.kind,
      description:
        first.kind === "invoke_menu"
          ? `Choose an enabled command in the observed ${first.path[0]} menu.`
          : DESCRIPTIONS[first.kind],
      actions: group,
    };
  });
}
function actionDescription(action: Action, observation: Observation): string {
  const target =
    action.kind === "click_element"
      ? observation.window?.elements.find(
          (element) => element.element_token === action.element_token,
        )
      : undefined;
  if (target !== undefined) {
    const label = target.label?.trim();
    return label === undefined || label.length === 0
      ? action.reason
      : `Activate ${target.role} ${JSON.stringify(label)}.`;
  }
  return describeAction(action);
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
