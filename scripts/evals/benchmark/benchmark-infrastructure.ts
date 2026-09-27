import type { Outcome } from "./benchmark-stats.ts";

const CLICK_FRESHNESS = "The browser changed before the click.";
function driverError(message: string): boolean {
  return message.startsWith("Playwright browser_") || message.startsWith(CLICK_FRESHNESS);
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
export { driverError, infrastructureGrade };
