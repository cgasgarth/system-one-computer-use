import type { OperationDecision } from "./decision-context.ts";

class ActionSelectionError extends Error {
  public readonly rejectedOperations: readonly OperationDecision[];
  public readonly groupCount: number;

  public constructor(rejectedOperations: readonly OperationDecision[], groupCount: number) {
    super(
      `The model selected no target across ${groupCount} operation groups on the current screen.`,
    );
    this.name = "ActionSelectionError";
    this.rejectedOperations = rejectedOperations;
    this.groupCount = groupCount;
  }

  public toJSON(): {
    readonly kind: "action_selection";
    readonly message: string;
    readonly rejectedOperations: readonly OperationDecision[];
    readonly groupCount: number;
  } {
    return {
      kind: "action_selection",
      message: this.message,
      rejectedOperations: this.rejectedOperations,
      groupCount: this.groupCount,
    };
  }
}

export { ActionSelectionError };
