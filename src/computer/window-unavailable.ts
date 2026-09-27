class WindowUnavailableError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "WindowUnavailableError";
  }
}

export { WindowUnavailableError };
