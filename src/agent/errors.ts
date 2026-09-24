class NoActionsError extends Error {
  public constructor() {
    super(
      "No usable control is available for the next step. The page may still be loading or need an unsupported action.",
    );
    this.name = "NoActionsError";
  }
}

export { NoActionsError };
