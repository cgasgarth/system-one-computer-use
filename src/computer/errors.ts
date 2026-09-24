class CuaError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "CuaError";
  }
}

export { CuaError };
