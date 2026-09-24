class PlanValidationError extends Error {
  public readonly detail: string;

  public constructor(detail: string) {
    super(
      "Could not plan this task. Try a specific app or page, or choose another text model in Settings.",
    );
    this.name = "PlanValidationError";
    this.detail = detail;
  }
}

export { PlanValidationError };
