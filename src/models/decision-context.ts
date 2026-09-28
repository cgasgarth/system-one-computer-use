import { describeAction, isEditableElement } from "../agent/contracts.ts";
import type { Action, Observation, Window } from "../agent/contracts.ts";
import { screenContent } from "../agent/screen-content.ts";
import { relevantControls, textTargetName } from "../agent/controls.ts";
import { observedTargetName, targetDescriptionContext } from "../agent/target-context.ts";
import { boundedContext } from "./request-budget.ts";
import { serializeMenuInspection } from "./menu-inspection.ts";
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

type ClickOperation = NonNullable<Extract<Action, { kind: "click_element" }>["operation"]>;
type ActionGroupKind = Exclude<Action["kind"], "click_element"> | `click_${ClickOperation}`;
interface ActionGroup {
  readonly kind: ActionGroupKind;
  readonly description: string;
  readonly actions: readonly Action[];
}
interface OperationDecision {
  readonly options: readonly string[];
  readonly answer: DecisionAnswer;
}
const DESCRIPTIONS: Readonly<Record<ActionGroupKind, string>> = {
  click_press: "Click a button or open an existing link.",
  click_pick: "Pick an observed option or item.",
  click_confirm: "Confirm an observed control.",
  click_open: "Open an observed item.",
  compose_text: "Enter or replace text in an editable field.",
  type_text: "Enter supplied text in an editable field.",
  request_url: "Navigate to a URL.",
  navigate: "Navigate to a supplied URL.",
  select_surface: "Switch between Chrome and Mac application tools.",
  press_key: "Use the keyboard for the focused control.",
  refresh: "Wait for the current page to update.",
  finish: "Finish because the current screen shows the complete requested result.",
  blocked: "Required input or access is missing. Stop.",
  request_app: "Open an installed application.",
  observe_window: "Select a different open window.",
  invoke_menu: "Use an observed command in this application's menu.",
  inspect_menu: "Open an observed application menu to view its commands without invoking one.",
};
function actionGroups(actions: readonly Action[]): readonly ActionGroup[] {
  const grouped = new Map<string, { kind: ActionGroupKind; menu?: string; actions: Action[] }>();
  for (const action of actions) {
    const kind: ActionGroupKind =
      action.kind === "click_element" ? `click_${action.operation ?? "press"}` : action.kind;
    const menu = action.kind === "invoke_menu" ? action.path[0] : undefined;
    if (action.kind === "invoke_menu" && menu === undefined) {
      throw new Error("An offered menu command is missing its observed top-level path.");
    }
    const key = menu === undefined ? kind : `invoke_menu:${JSON.stringify(menu)}`;
    const group = grouped.get(key) ?? {
      kind,
      actions: [],
      ...(menu === undefined ? {} : { menu }),
    };
    group.actions.push(action);
    grouped.set(key, group);
  }
  return [...grouped.values()].map((group) => {
    let description = DESCRIPTIONS[group.kind];
    if (group.menu !== undefined) {
      description = `Use a command in the observed ${JSON.stringify(group.menu)} menu.`;
    } else if (group.kind === "navigate") {
      description = `Navigate to a supplied URL: ${group.actions
        .filter(
          (action): action is Extract<Action, { kind: "navigate" }> => action.kind === "navigate",
        )
        .slice(0, MAX_GROUP_URLS)
        .map(
          (action) =>
            `${action.url.slice(0, MAX_URL_CHARS)} (${action.reason.slice(0, MAX_URL_CHARS)})`,
        )
        .join(
          " | ",
        )}${group.actions.length > MAX_GROUP_URLS ? ` | and ${group.actions.length - MAX_GROUP_URLS} more` : ""}.`;
    }
    return { kind: group.kind, description, actions: group.actions };
  });
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
    `Current visible content and values:\n${screenContent(observation) || "No content or values reported."}`,
    `Visible controls and values: ${controls.slice(0, Math.max(MIN_STATE_CHARS, MAX_STATE_CHARS - contextLength))}`,
    ...(remaining.length === 0
      ? []
      : [`Further actionable controls (${remaining.length} later rows): ${laterSummary}`]),
  ];
  return lines.join("\n");
}

function requiredState(input: DecisionInput): string[] {
  const state = [
    `User request: ${input.task}`,
    "Choose the next step from the current screen. A tool returning does not prove its intended result. Finish only when the current content shows the whole requested outcome.",
  ];
  if (input.selectedOperation !== undefined) {
    state.push(`Selected operation for this next step: ${input.selectedOperation}`);
  }
  if (input.observation.window !== undefined) {
    const { window } = input.observation;
    state.push(`Current window: ${window.app_name}: ${window.window_title}`);
    if (window.url !== undefined) {
      state.push(`Current URL: ${window.url}`);
    }
  }
  return state;
}

function decisionState(input: DecisionInput, contextBudget = MAX_STATE_CHARS): string {
  const context: string[] = [];
  const state = requiredState(input);
  const switches = input.actions
    .filter(
      (action): action is Extract<Action, { kind: "select_surface" }> =>
        action.kind === "select_surface",
    )
    .map((action) => action.surface);
  if (input.mode === undefined) {
    state.push(
      `No tool set selected yet. Available tool sets: ${switches.join(", ") || "none"}.`,
      `Running applications: ${input.observation.desktop.apps.map((app) => app.name).join(", ")}.`,
    );
  } else {
    state.push(
      `Selected tool set: ${input.mode}. ${switches.length === 0 ? "No other tool set is offered now." : `Available switch targets: ${switches.join(", ")}.`}`,
    );
    if (input.observation.menuInspection !== undefined) {
      context.push(serializeMenuInspection(input.observation.menuInspection));
    }
    if (input.observation.menuInspectionError !== undefined) {
      context.push(`Menu inspection unavailable: ${input.observation.menuInspectionError}`);
    }
    context.push(describeObservation(input.observation, input.context?.length ?? 0));
  }
  if (input.feedback !== undefined && input.feedback.length > 0) {
    context.push(input.feedback);
  }
  if (input.context !== undefined && input.context.length > 0) {
    context.push(`Earlier session context: ${input.context}`);
  }
  if (input.operationContext !== undefined) {
    context.push(input.operationContext);
  }
  return [...state, ...boundedContext(context, contextBudget)].join("\n");
}

function operationState(
  input: DecisionInput,
  actions: readonly Action[],
  contextBudget = MAX_STATE_CHARS,
): string {
  const groups = new Map<string, { path: readonly string[]; commands: string[] }>();
  const inspectedNames: string[] = [];
  for (const action of actions) {
    if (action.kind === "inspect_menu") {
      inspectedNames.push(action.topLevel);
    }
    if (action.kind === "invoke_menu") {
      const parent = action.path.slice(0, -1);
      const key = JSON.stringify(parent);
      const group = groups.get(key) ?? { path: parent, commands: [] };
      group.commands.push(...action.path.slice(-1));
      groups.set(key, group);
    }
  }
  if (groups.size === 0 && inspectedNames.length === 0) {
    return decisionState(input, contextBudget);
  }
  const incomplete = input.observation.window?.menuComplete === false;
  const operationContext = [
    ...(incomplete
      ? ["Observed application menu inventory is incomplete; other commands may exist."]
      : []),
    ...(inspectedNames.length === 0
      ? []
      : [`Observed top-level menus offered for inspection: ${JSON.stringify(inspectedNames)}`]),
    ...(groups.size === 0
      ? []
      : [`Available observed menu paths: ${JSON.stringify([...groups.values()])}`]),
  ].join("\n");
  return decisionState({ ...input, operationContext }, contextBudget);
}

function operationTargetInput(
  input: DecisionInput,
  operation: OperationDecision | undefined,
): DecisionInput {
  if (operation === undefined) {
    return input;
  }
  const description = operation.options.find(
    (_option, index) => `A${index}` === operation.answer.choice,
  );
  if (description === undefined) {
    throw new Error("The selected operation has no matching observed description.");
  }
  return {
    ...input,
    selectedOperation: description,
  };
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
  operationState,
  operationTargetInput,
  describeControl,
  MAX_STATE_CHARS,
};
export type { OperationDecision };
