class CuaError extends Error {
  public readonly code: "operation_failed" | "keyboard_target_ambiguous";
  public constructor(message: string, code: CuaError["code"] = "operation_failed") {
    super(message);
    this.name = "CuaError";
    this.code = code;
  }
}

export { CuaError };
