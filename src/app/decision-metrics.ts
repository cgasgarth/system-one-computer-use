import type { TaskStep } from "../agent/types.ts";

const MS_PER_SECOND = 1000;
const HALF = 2;
interface DecisionMetrics {
  readonly medianDecisionMs: number | undefined;
  readonly modelActionsPerSecond: number | undefined;
}
type TimedStep = Pick<TaskStep, "decisionMs" | "actionMs" | "elapsedMs">;
function decisionMetrics(steps: readonly TimedStep[]): DecisionMetrics {
  const [first] = steps;
  const last = steps.at(-1);
  if (first === undefined || last === undefined) {
    return { medianDecisionMs: undefined, modelActionsPerSecond: undefined };
  }
  const latencies = steps.map((step) => step.decisionMs).toSorted((left, right) => left - right);
  const middle = Math.floor(latencies.length / HALF);
  const upper = latencies[middle];
  const lower = latencies[middle - 1];
  if (upper === undefined) {
    throw new Error("Decision timing is missing");
  }
  const medianDecisionMs =
    latencies.length % HALF === 0 && lower !== undefined ? (lower + upper) / HALF : upper;
  const firstDecisionStarted = first.elapsedMs - first.decisionMs - first.actionMs;
  const activeMs = last.elapsedMs - firstDecisionStarted;
  return {
    medianDecisionMs,
    modelActionsPerSecond: activeMs > 0 ? (steps.length * MS_PER_SECOND) / activeMs : undefined,
  };
}
export { decisionMetrics };
