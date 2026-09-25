import type { ComputerMode, ManagedComputer } from "../computer/types.ts";
import type { ActionProbabilities, CompletionAnswer } from "../models/system-one-schema.ts";
import type { DecisionModel } from "../models/system-one.ts";
import type { TextModel } from "../models/text.ts";
import type { Action } from "./contracts.ts";
import type { Surface } from "../app/sessions/schema.ts";
import type { UnchangedDestination } from "./progress.ts";

interface ActionResult {
  readonly output: string;
  readonly unchanged?: UnchangedDestination;
}

interface TaskStep {
  readonly action: Action;
  readonly decisionMs: number;
  readonly observationMs: number;
  readonly actionMs: number;
  readonly elapsedMs: number;
  readonly observation: string;
  readonly observationError?: string;
  readonly output?: string;
  readonly error?: string;
  readonly unchanged?: UnchangedDestination;
  readonly index: number;
  readonly probabilities: ActionProbabilities;
  readonly completion?: CompletionAnswer;
}
interface TaskResult {
  readonly status: "complete" | "blocked";
  readonly requestsPerSecond: number;
  readonly steps: readonly TaskStep[];
  readonly summary: string;
  readonly task: string;
  readonly totalMs: number;
  readonly surface?: Surface;
}
interface TaskOptions {
  readonly computer: (mode: ComputerMode) => ManagedComputer;
  readonly applications: readonly string[];
  readonly decision: DecisionModel;
  readonly text: TextModel;
  readonly task: string;
  readonly context?: string;
  readonly recentResults?: readonly string[];
  readonly preferredSurface?: ComputerMode;
  readonly previousSurface?: Surface;
  readonly signal?: Readonly<Pick<AbortSignal, "aborted" | "throwIfAborted">>;
  readonly onStep?: (step: TaskStep) => void | Promise<void>;
}
export type { TaskStep, TaskResult, TaskOptions, ActionResult };
