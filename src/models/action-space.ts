import { describeAction } from "../agent/contracts.ts";
import type { Action, Observation } from "../agent/contracts.ts";
import type { DecisionAnswer } from "./system-one-schema.ts";

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
  open_document: "Open a document through the application's file chooser.",
};
function actionGroups(actions: readonly Action[]): readonly ActionGroup[] {
  const grouped = new Map<Action["kind"], Action[]>();
  for (const action of actions) {
    const group = grouped.get(action.kind) ?? [];
    group.push(action);
    grouped.set(action.kind, group);
  }
  return [...grouped].map(([kind, group]) => ({
    kind,
    description: DESCRIPTIONS[kind],
    actions: group,
  }));
}
function actionDescription(action: Action, observation: Observation): string {
  const target =
    action.kind === "click_element"
      ? observation.window?.elements.find(
          (element) => element.element_token === action.element_token,
        )
      : undefined;
  if (target !== undefined) {
    return `Activate ${target.role} ${JSON.stringify(target.label ?? "")}.`;
  }
  return describeAction(action);
}
function targetCorrectionActions(input: {
  readonly actions: readonly Action[];
  readonly observation: Observation;
}): readonly Action[] {
  const navigationRoles = new Set(["link", "AXLink", "tab", "treeitem", "row", "cell"]);
  return input.actions.filter((action) => {
    if (action.kind === "compose_text" || action.kind === "type_text") {
      return false;
    }
    if (action.kind === "press_key") {
      return action.key === "escape";
    }
    if (action.kind === "click_element") {
      const target = input.observation.window?.elements.find(
        (element) => element.element_token === action.element_token,
      );
      return navigationRoles.has(target?.role ?? "");
    }
    return true;
  });
}
export { actionDescription, actionGroups, targetCorrectionActions };
export type { OperationDecision };
