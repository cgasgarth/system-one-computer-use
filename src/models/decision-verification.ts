import type { Action } from "../agent/contracts.ts";
import type { DecisionInput } from "./system-one.ts";
import type { BinaryAnswer, DecisionRequest } from "./system-one-schema.ts";

interface ActionCheck {
  readonly action: Action;
  readonly answer: BinaryAnswer;
}

function verificationRequest(
  action: Action,
  input: DecisionInput,
  model: string,
): DecisionRequest | undefined {
  if (action.kind !== "observe_window" && action.kind !== "blocked") {
    return undefined;
  }
  const target =
    action.kind === "observe_window"
      ? input.observation.desktop.windows.find(
          (window) => window.pid === action.pid && window.window_id === action.window_id,
        )
      : undefined;
  const current = input.observation.window;
  const state = [
    input.context ?? "",
    `User request: ${input.task}`,
    ...(target === undefined
      ? []
      : [`Proposed action: Inspect ${target.app_name}: ${target.title}`]),
    current === undefined
      ? "No window has been selected."
      : `Current window: ${current.app_name}: ${current.window_title}`,
    "Available tools: open installed applications, inspect windows, and control Chrome.",
  ].join("\n");
  const blocked = action.kind === "blocked";
  return {
    model,
    state,
    questions: {
      next_action: {
        type: "choice",
        instructions: blocked
          ? "Does a missing permission, required user input, or unavailable control prevent further progress?"
          : "Does the proposed action directly advance the user request?",
        criteria: blocked
          ? {
              A0: "true: User help is required before the agent can proceed.",
              A1: "false: Available tools can still advance the request.",
            }
          : {
              A0: "true: This action directly advances the user request.",
              A1: "false: This action is unrelated or unnecessary for the user request.",
            },
      },
    },
  };
}

export { verificationRequest };
export type { ActionCheck };
