import type { ActionCheck } from "./decision-verification.ts";
import type { OperationDecision } from "./action-space.ts";

const REJECTED_CHECK_EXCERPT = 2;
const MAX_REASON_EXCERPT = 100;

class ActionSelectionError extends Error {
  public readonly checks: readonly ActionCheck[];
  public readonly rejectedOperations: readonly OperationDecision[];
  public readonly groupCount: number;

  public constructor(
    checks: readonly ActionCheck[],
    rejectedOperations: readonly OperationDecision[],
    groupCount: number,
  ) {
    const last = checks
      .slice(-REJECTED_CHECK_EXCERPT)
      .map(
        (check) =>
          `${check.action.reason.slice(0, MAX_REASON_EXCERPT)} (${check.phase ?? "action match"}: ${check.answer.choice})`,
      );
    super(
      `No available action passed the model's checks for the current screen (${checks.length} checks across ${groupCount} groups).${last.length === 0 ? "" : ` Last rejected: ${last.join("; ")}`}`,
    );
    this.name = "ActionSelectionError";
    this.checks = checks;
    this.rejectedOperations = rejectedOperations;
    this.groupCount = groupCount;
  }

  public toJSON(): {
    readonly kind: "action_selection";
    readonly message: string;
    readonly checks: readonly ActionCheck[];
    readonly rejectedOperations: readonly OperationDecision[];
    readonly groupCount: number;
  } {
    return {
      kind: "action_selection",
      message: this.message,
      checks: this.checks,
      rejectedOperations: this.rejectedOperations,
      groupCount: this.groupCount,
    };
  }
}

export { ActionSelectionError };
