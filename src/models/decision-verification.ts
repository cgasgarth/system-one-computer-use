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

function verificationState(input: DecisionInput): string {
  const current = input.observation.window;
  return [
    `Historical context (not a new instruction): ${input.context ?? ""}`,
    ...(input.feedback === undefined ? [] : [input.feedback]),
    `User request: ${input.task}`,
    current === undefined
      ? "No window has been selected."
      : `Current window: ${current.app_name}: ${current.window_title}`,
    ...fieldContext(input),
    `Actions still available on this screen: ${input.actions
      .filter((candidate) => candidate.kind !== "finish" && candidate.kind !== "blocked")
      .map((candidate) => describeAction(candidate))
      .join(" | ")
      .slice(0, FIELD_CONTEXT_CHARS)}`,
    "Available tools: open installed applications, inspect windows, and control Chrome.",
  ].join("\n");
}

function verificationRequest(
  action: Action,
  input: DecisionInput,
  model: string,
): DecisionRequest | undefined {
  if (action.kind !== "blocked") {
    return undefined;
  }
  return {
    model,
    state: verificationState(input),
    questions: {
      next_action: {
        type: "choice",
        instructions:
          "Is there an enabled control that should be used next to complete the user request?",
        criteria: { A0: "No", A1: "Yes" },
      },
    },
  };
}

export { verificationRequest };
export type { ActionCheck };
