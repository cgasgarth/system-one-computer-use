import { isEditableElement } from "../agent/contracts.ts";
import type { Action, Window } from "../agent/contracts.ts";
import type { ActionCheck } from "./decision-verification.ts";
import type { DecisionInput } from "./system-one.ts";
import type { BinaryAnswer, DecisionRequest } from "./system-one-schema.ts";

const COMMIT_CONFIDENCE = 0.9;
const MISSING_CHANGE_CONFIDENCE = 0.55;
const CHECK_ROLES = new Set([
  "checkbox",
  "radio",
  "switch",
  "combobox",
  "AXCheckBox",
  "AXRadioButton",
  "AXPopUpButton",
]);
type Judge = (request: DecisionRequest) => Promise<BinaryAnswer>;

function question(input: {
  readonly model: string;
  readonly state: string;
  readonly instructions: string;
  readonly yes: string;
  readonly no: string;
}): DecisionRequest {
  return {
    model: input.model,
    state: input.state,
    questions: {
      next_action: {
        type: "choice",
        instructions: input.instructions,
        criteria: { A0: input.yes, A1: input.no },
      },
    },
  };
}

function target(
  action: Action,
  window: Window | undefined,
): Window["elements"][number] | undefined {
  return action.kind === "click_element"
    ? window?.elements.find((element) => element.element_token === action.element_token)
    : undefined;
}

function formControls(window: Window): readonly Window["elements"][number][] {
  return window.elements.filter(
    (element) => isEditableElement(element) || CHECK_ROLES.has(element.role),
  );
}

function controlDescription(control: Window["elements"][number], window: Window): string {
  const options = window.elements
    .filter(
      (element) => element.parent_index === control.element_index && element.role === "option",
    )
    .map((element) => `${element.label ?? ""}${element.selected === true ? " (selected)" : ""}`);
  return [
    `${control.role} ${JSON.stringify(control.label ?? "")}`,
    `current value ${JSON.stringify(control.value ?? "")}`,
    ...(options.length === 0 ? [] : [`options: ${options.join(", ")}`]),
  ].join("; ");
}

// A persistent action needs separate effect, authorization, and field checks.
// eslint-disable-next-line eslint/max-statements, eslint/complexity, eslint/max-lines-per-function
async function verifyCommit({
  action,
  input,
  model,
  judge,
}: {
  readonly action: Action;
  readonly input: DecisionInput;
  readonly model: string;
  readonly judge: Judge;
}): Promise<{ readonly allowed: boolean; readonly checks: readonly ActionCheck[] }> {
  const control = target(action, input.observation.window);
  if (action.kind !== "click_element" || control === undefined) {
    return { allowed: true, checks: [] };
  }
  const clicked = `${control.role} ${JSON.stringify(control.label ?? "")}`;
  const inspected = await input.inspectClick?.(action);
  const classification =
    inspected?.kind === "form_submit"
      ? ({ choice: "A0", probabilities: { A0: 1, A1: 0 } } as const)
      : await judge(
          question({
            model,
            state: `Observed control: ${clicked}. Current dialog: ${input.observation.window?.elements.some((element) => ["dialog", "alertdialog", "AXDialog", "AXSheet", "AXPopover"].includes(element.role)) === true ? "open" : "closed"}.`,
            instructions: "Would this exact click commit a persistent data change now?",
            yes: "Yes. It saves, creates, sends, submits, deletes, or changes stored data now.",
            no: "No. It only opens, chooses, navigates, or closes a view without a persistent data change.",
          }),
        );
  const checks: ActionCheck[] = [
    {
      action,
      answer: classification,
      phase: inspected?.kind === "form_submit" ? "form-semantics" : "commit-classification",
      source: inspected?.kind === "form_submit" ? "dom" : "model",
    },
  ];
  if (classification.choice === "A1") {
    return { allowed: true, checks };
  }
  const authorization = await judge(
    question({
      model,
      state: `User request: ${input.task}. Previous session context for references only: ${input.context ?? ""}.`,
      instructions: "May this request make a persistent data change now?",
      yes: "Yes. The user requested a created, saved, sent, submitted, deleted, or otherwise stored change.",
      no: "No. The user requested only a view, an open draft, a discarded draft, or another state with no stored change.",
    }),
  );
  checks.push({ action, answer: authorization, phase: "commit-authorization" });
  if (
    authorization.choice !== "A0" ||
    (authorization.probabilities["A0"] ?? 0) < COMMIT_CONFIDENCE
  ) {
    return { allowed: false, checks };
  }
  const { window } = input.observation;
  if (window === undefined) {
    return { allowed: false, checks };
  }
  for (const field of formControls(window)) {
    // Each control check needs the answer from the same current observation.
    // eslint-disable-next-line no-await-in-loop
    const answer = await judge(
      question({
        model,
        state: `User request: ${input.task}. Proposed persistent action: click ${clicked}. Observed field: ${controlDescription(field, window)}.`,
        instructions:
          "Is a user-requested change to this field still missing from the observed state?",
        yes: "Yes. The request specifies a different value or state for this field.",
        no: "No. This field already matches the request, or the request does not mention it.",
      }),
    );
    checks.push({
      action,
      answer,
      phase: "field-readiness",
      control: { role: field.role, label: field.label ?? "" },
    });
    if (answer.choice === "A0" && (answer.probabilities["A0"] ?? 0) >= MISSING_CHANGE_CONFIDENCE) {
      return { allowed: false, checks };
    }
  }
  return { allowed: true, checks };
}

export { verifyCommit };
