import type { WriteCounts } from "./benchmark-cases.ts";

type Outcome =
  | "success"
  | "blocked"
  | "wrong-result"
  | "wrong-write-count"
  | "unintended-write"
  | "capacity"
  | "format"
  | "timeout"
  | "model-error"
  | "driver-error"
  | "infrastructure-invalid";
interface TrialRecord {
  readonly modelId: string;
  readonly caseId: string;
  readonly trial: number;
  readonly outcome: Outcome;
  readonly gradedOutcome: Outcome;
  readonly taskStatus: "complete" | "blocked" | "error" | "not-started";
  readonly driverErrors: readonly string[];
  readonly initialStateHash?: string;
  readonly taskMs: number;
  readonly turns: number;
  readonly decisionRequests: number;
  readonly completedDecisionRequestMs: readonly number[];
  readonly textRequests: number;
  readonly completedTextRequestMs: readonly number[];
  readonly writeDelta: WriteCounts;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly error?: string;
}
interface Summary {
  readonly modelId: string;
  readonly success: number;
  readonly total: number;
  readonly successRate: number | undefined;
  readonly failures: Readonly<Record<Exclude<Outcome, "success">, number>>;
  readonly medianSuccessfulTaskSeconds: number | undefined;
  readonly medianSuccessfulTurns: number | undefined;
  readonly medianCompletedDecisionRequestMs: number | undefined;
  readonly completedDecisionRequests: number;
  readonly medianSuccessfulDecisionRequests: number | undefined;
  readonly medianSuccessfulTextRequestMs: number | undefined;
}
const HALF = 2;
const MS_PER_SECOND = 1000;

function median(values: readonly number[]): number | undefined {
  if (values.length === 0) {
    return undefined;
  }
  const sorted = values.toSorted((left, right) => left - right);
  const middle = Math.floor(sorted.length / HALF);
  const upper = sorted[middle];
  const lower = sorted[middle - 1];
  return sorted.length % HALF === 0 && lower !== undefined && upper !== undefined
    ? (lower + upper) / HALF
    : upper;
}
function summarize(modelId: string, trials: readonly TrialRecord[]): Summary {
  const selected = trials.filter((trial) => trial.modelId === modelId);
  const successful = selected.filter((trial) => trial.outcome === "success");
  const requests = selected.flatMap((trial) => trial.completedDecisionRequestMs);
  const count = (outcome: Exclude<Outcome, "success">): number =>
    selected.filter((trial) => trial.outcome === outcome).length;
  const failures = {
    blocked: count("blocked"),
    "wrong-result": count("wrong-result"),
    "wrong-write-count": count("wrong-write-count"),
    "unintended-write": count("unintended-write"),
    capacity: count("capacity"),
    format: count("format"),
    timeout: count("timeout"),
    "model-error": count("model-error"),
    "driver-error": count("driver-error"),
    "infrastructure-invalid": count("infrastructure-invalid"),
  };
  return {
    modelId,
    success: successful.length,
    total: selected.length,
    successRate: selected.length === 0 ? undefined : successful.length / selected.length,
    failures,
    medianSuccessfulTaskSeconds: median(successful.map((trial) => trial.taskMs / MS_PER_SECOND)),
    medianSuccessfulTurns: median(successful.map((trial) => trial.turns)),
    medianCompletedDecisionRequestMs: median(requests),
    completedDecisionRequests: requests.length,
    medianSuccessfulDecisionRequests: median(successful.map((trial) => trial.decisionRequests)),
    medianSuccessfulTextRequestMs: median(
      successful.flatMap((trial) => trial.completedTextRequestMs),
    ),
  };
}

export { median, summarize };
export type { Outcome, Summary, TrialRecord };
