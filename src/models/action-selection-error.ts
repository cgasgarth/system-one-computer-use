import type { ActionCheck } from "./action-check.ts";
import type { OperationDecision } from "./decision-context.ts";
import type { Action } from "../agent/contracts.ts";

const REJECTED_CHECK_EXCERPT = 2;
const MAX_REASON_EXCERPT = 100;
interface RejectedAction {
  readonly action: Action;
  readonly reason: string;
}

class ActionSelectionError extends Error {
  public readonly checks: readonly ActionCheck[];
  public readonly rejectedOperations: readonly OperationDecision[];
  public readonly rejectedActions: readonly RejectedAction[];
  public readonly groupCount: number;

  public constructor(
    checks: readonly ActionCheck[],
    rejectedOperations: readonly OperationDecision[],
    context: Readonly<{ groupCount: number; rejectedActions?: readonly RejectedAction[] }>,
  ) {
    const rejectedActions = context.rejectedActions ?? [];
    const last = checks
      .slice(-REJECTED_CHECK_EXCERPT)
      .map(
        (check) =>
          `${check.action.reason.slice(0, MAX_REASON_EXCERPT)} (${check.phase ?? "action match"}: ${check.answer.choice})`,
      );
    super(
      `No available action passed the model's checks for the current screen (${checks.length} checks, ${rejectedActions.length} rejected actions across ${context.groupCount} groups).${last.length === 0 ? "" : ` Last rejected: ${last.join("; ")}`}`,
    );
    this.name = "ActionSelectionError";
    this.checks = checks;
    this.rejectedOperations = rejectedOperations;
    this.rejectedActions = rejectedActions;
    this.groupCount = context.groupCount;
  }

  public toJSON(): {
    readonly kind: "action_selection";
    readonly message: string;
    readonly checks: readonly ActionCheck[];
    readonly rejectedOperations: readonly OperationDecision[];
    readonly rejectedActions: readonly RejectedAction[];
    readonly groupCount: number;
  } {
    return {
      kind: "action_selection",
      message: this.message,
      checks: this.checks,
      rejectedOperations: this.rejectedOperations,
      rejectedActions: this.rejectedActions,
      groupCount: this.groupCount,
    };
  }
}

export { ActionSelectionError };
export type { RejectedAction };
