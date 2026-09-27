const MS_PER_SECOND = 1000;
const HALF = 2;
interface DecisionMetrics {
  readonly medianDecisionMs: number | undefined;
  readonly modelActionsPerSecond: number | undefined;
}
interface MetricsInput {
  readonly steps: readonly { readonly performedAction?: boolean }[];
  readonly elapsedMs: number;
  readonly decisionRequestMs: readonly number[];
}
function decisionMetrics(input: MetricsInput): DecisionMetrics {
  const latencies = input.decisionRequestMs.toSorted((left, right) => left - right);
  const middle = Math.floor(latencies.length / HALF);
  const upper = latencies[middle];
  const lower = latencies[middle - 1];
  let medianDecisionMs = upper;
  if (upper !== undefined && latencies.length % HALF === 0 && lower !== undefined) {
    medianDecisionMs = (lower + upper) / HALF;
  }
  const actions = input.steps.filter((step) => step.performedAction === true).length;
  return {
    medianDecisionMs,
    modelActionsPerSecond:
      input.elapsedMs > 0 ? (actions * MS_PER_SECOND) / input.elapsedMs : undefined,
  };
}
export { decisionMetrics };
