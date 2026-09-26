import type { Action } from "../agent/contracts.ts";
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
  const target =
    action.kind === "observe_window"
      ? input.observation.desktop.windows.find(
          (window) => window.pid === action.pid && window.window_id === action.window_id,
        )
      : undefined;
  const current = input.observation.window;
  const control =
    action.kind === "click_element" || action.kind === "compose_text"
      ? current?.elements.find((element) => element.element_token === action.element_token)
      : undefined;
  return [
    input.context ?? "",
    ...(action.kind === "blocked" && input.feedback !== undefined ? [input.feedback] : []),
    `User request: ${input.task}`,
    ...(target === undefined
      ? []
      : [`Proposed action: Inspect ${target.app_name}: ${target.title}`]),
    ...(action.kind === "click_element" || action.kind === "compose_text"
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
    action.kind !== "observe_window" &&
    action.kind !== "blocked" &&
    action.kind !== "click_element" &&
    action.kind !== "compose_text"
  ) {
    return undefined;
  }
  const blocked = action.kind === "blocked";
  let instructions = "Does the proposed action directly advance the user request?";
  if (blocked) {
    instructions =
      "Is there an enabled control that should be used next to complete the user request?";
  } else if (action.kind === "click_element") {
    instructions =
      "Is this exact click permitted by the user's request and appropriate now, given the observed state?";
  } else if (action.kind === "compose_text") {
    instructions = "Does entering text into this specific field advance the user request?";
  }
  let criteria = {
    A0: "true: This action directly advances the user request.",
    A1: "false: This action is unrelated or unnecessary for the user request.",
  };
  if (blocked) {
    criteria = { A0: "No", A1: "Yes" };
  } else if (action.kind === "click_element") {
    criteria = {
      A0: "true: This click is permitted and advances the request now. If it saves or submits, all requested changes are already present.",
      A1: "false: This click is prohibited, premature, or would save or submit when the user asked to leave a draft open.",
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
