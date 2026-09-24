import type { Computer } from "../computer/types.ts";
import type { ActionProbabilities } from "../models/system-one-schema.ts";
import type { DecisionModel } from "../models/system-one.ts";
import type { TextModel } from "../models/text.ts";
import type { Action, TaskPlan } from "./contracts.ts";

interface TaskStep {
  readonly action: Action;
  readonly decisionMs: number;
  readonly observationMs: number;
  readonly actionMs: number;
  readonly elapsedMs: number;
  readonly error?: string;
  readonly index: number;
  readonly probabilities: ActionProbabilities;
}
interface TaskResult {
  readonly requestsPerSecond: number;
  readonly steps: readonly TaskStep[];
  readonly summary: string;
  readonly task: string;
  readonly textMs: number;
  readonly totalMs: number;
}
interface TaskOptions {
  readonly computer: Computer;
  readonly decision: DecisionModel;
  readonly signal?: Readonly<Pick<AbortSignal, "aborted" | "throwIfAborted">>;
  readonly onStep?: (step: TaskStep) => void;
  readonly task: string;
  readonly text: TextModel;
  readonly plan?: TaskPlan;
  readonly preparationMs?: number;
}
interface WindowTarget {
  readonly pid: number;
  readonly windowId: number;
}
interface Progress {
  readonly attempted: ReadonlySet<string>;
  readonly clickedTargetBeforeTitle: string | undefined;
  readonly hasActed: boolean;
  readonly hasNavigated: boolean;
  readonly hasTaskAction: boolean;
  readonly textEntry: { readonly text: string; readonly label: string | undefined } | undefined;
  readonly target: WindowTarget | undefined;
}

export type { Progress, TaskOptions, TaskResult, TaskStep, WindowTarget };
