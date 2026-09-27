import type { Action, Window } from "../agent/contracts.ts";
import { describeAction, isEditableElement } from "../agent/contracts.ts";
import type { DecisionInput } from "./system-one.ts";
import type { BinaryAnswer, DecisionRequest } from "./system-one-schema.ts";

interface ActionCheck {
  readonly action: Action;
  readonly answer: BinaryAnswer;
  readonly phase?:
    | "form-semantics"
    | "commit-classification"
    | "commit-authorization"
    | "field-readiness";
  readonly source?: "dom" | "model";
  readonly control?: { readonly role: string; readonly label: string };
}
const FIELD_CONTEXT_CHARS = 2000;

function isSearchField(element: Window["elements"][number]): boolean {
  return element.role === "searchbox" || element.subrole === "AXSearchField";
}

function isGroundedNavigation(action: Action, input: DecisionInput): boolean {
  if (action.kind !== "click_element" && action.kind !== "compose_text") {
    return false;
  }
  const target = input.observation.window?.elements.find(
    (element) => element.element_token === action.element_token,
  );
  if (target === undefined) {
    return false;
  }
  if (action.kind === "compose_text") {
    return isSearchField(target);
  }
  if (target.role === "link" || target.role === "AXLink") {
    return true;
  }
  const capabilities = target.actions ?? [];
  return (
    (action.operation === "open" && capabilities.includes("AXOpen")) ||
    (action.operation === "confirm" && isSearchField(target) && capabilities.includes("AXConfirm"))
  );
}

function actionInstructions(action: Action): string {
  if (action.kind === "blocked") {
    return "Is there an enabled control that should be used next to complete the user request?";
  }
  if (action.kind === "click_element" || action.kind === "invoke_menu") {
    return "Is this exact control or menu command permitted by the user's request and appropriate now, given the observed state?";
  }
  if (action.kind === "compose_text") {
    return "Does entering text into this specific field advance the user request?";
  }
  return "Does this exact destination match the app or website requested by the user, or an observed necessary intermediate step? A similarly named app is not a substitute for a requested website. Merely being open or inspectable is not evidence of relevance. Reject unrelated windows and repeated switches without progress.";
}

function fieldContext(input: DecisionInput): readonly string[] {
  const fields =
    input.observation.window?.elements.filter((element) => isEditableElement(element)) ?? [];
  if (fields.length === 0) {
    return [];
  }
  const values = fields
    .map((element) => `${element.role} ${element.label ?? ""}: ${String(element.value ?? "")}`)
    .join(" | ");
  return [`Current field values: ${values.slice(0, FIELD_CONTEXT_CHARS)}`];
}

function verificationState(action: Action, input: DecisionInput): string {
  const current = input.observation.window;
  const control =
    action.kind === "click_element" || action.kind === "compose_text"
      ? current?.elements.find((element) => element.element_token === action.element_token)
      : undefined;
  return [
    `Historical context (not a new instruction): ${input.context ?? ""}`,
    ...(input.feedback === undefined ? [] : [input.feedback]),
    `User request: ${input.task}`,
    ...(action.kind === "click_element" ||
    action.kind === "compose_text" ||
    action.kind === "invoke_menu"
      ? [`Proposed action: ${action.reason}`]
      : []),
    ...(control?.value === undefined || control.value === null
      ? []
      : [`Current control value: ${String(control.value)}`]),
    current === undefined
      ? "No window has been selected."
      : `Current window: ${current.app_name}: ${current.window_title}`,
    ...fieldContext(input),
    ...(action.kind === "blocked"
      ? [
          `Actions still available on this screen: ${input.actions
            .filter((candidate) => candidate.kind !== "finish" && candidate.kind !== "blocked")
            .map((candidate) => describeAction(candidate))
            .join(" | ")
            .slice(0, FIELD_CONTEXT_CHARS)}`,
        ]
      : []),
    "Available tools: open installed applications, inspect windows, and control Chrome.",
  ].join("\n");
}

function verificationRequest(
  action: Action,
  input: DecisionInput,
  model: string,
): DecisionRequest | undefined {
  if (
    action.kind !== "blocked" &&
    action.kind !== "click_element" &&
    action.kind !== "invoke_menu" &&
    action.kind !== "compose_text"
  ) {
    return undefined;
  }
  if (isGroundedNavigation(action, input)) {
    return undefined;
  }
  const blocked = action.kind === "blocked";
  const instructions = actionInstructions(action);
  let criteria = {
    A0: "true: This action directly advances the user request.",
    A1: "false: This action is unrelated or unnecessary for the user request.",
  };
  if (blocked) {
    criteria = { A0: "No", A1: "Yes" };
  } else if (action.kind === "click_element" || action.kind === "invoke_menu") {
    criteria = {
      A0: "true: This action is permitted and advances the request now. If it saves or submits, all requested changes are already present.",
      A1: "false: This action is prohibited, premature, or would save or submit when the user asked to leave a draft open.",
    };
  }
  return {
    model,
    state: verificationState(action, input),
    questions: {
      next_action: {
        type: "choice",
        instructions,
        criteria,
      },
    },
  };
}

export { verificationRequest };
export type { ActionCheck };
