import type { Outcome } from "./benchmark-stats.ts";

const CLICK_FRESHNESS = "The browser changed before the click.";
function externalTargetKind(message: string): "observed-escape" | "blocked-target" | undefined {
  if (message.startsWith("The model left the disposable localhost fixture")) {
    return "observed-escape";
  }
  if (
    message.startsWith("The model selected a link outside the disposable localhost fixture") ||
    message.startsWith("The model selected a URL outside the disposable localhost fixture") ||
    message.startsWith("The saved browser target is outside the disposable localhost fixture")
  ) {
    return "blocked-target";
  }
  return undefined;
}
function driverError(message: string): boolean {
  return (
    message.startsWith("Codex controls") ||
    message.startsWith("Codex Chrome") ||
    message.startsWith(CLICK_FRESHNESS)
  );
}
function infrastructureGrade(
  gradedOutcome: Outcome,
  steps: readonly { readonly error?: string }[],
  terminalError?: string,
): { readonly outcome: Outcome; readonly driverErrors: readonly string[] } {
  const driverErrors = steps.flatMap((step) =>
    step.error !== undefined && driverError(step.error)
      ? [step.error.split("\n")[0] ?? step.error]
      : [],
  );
  if (terminalError !== undefined && driverError(terminalError)) {
    driverErrors.push(terminalError.split("\n")[0] ?? terminalError);
  }
  return {
    outcome: driverErrors.length === 0 ? gradedOutcome : "infrastructure-invalid",
    driverErrors,
  };
}
export { driverError, externalTargetKind, infrastructureGrade };
