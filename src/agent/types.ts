import type { ComputerMode, ManagedComputer } from "../computer/types.ts";
import type { ActionProbabilities, BinaryAnswer } from "../models/system-one-schema.ts";
import type { DecisionModel } from "../models/system-one.ts";
import type { TextModel } from "../models/text.ts";
import type { Action } from "./contracts.ts";
import type { Surface } from "../app/sessions/schema.ts";
import type { UnchangedDestination } from "./progress.ts";
import type { ActionCheck } from "../models/decision-verification.ts";
import type { OperationDecision } from "../models/action-space.ts";

interface ActionResult {
  readonly output: string;
  readonly satisfiedInput?: string;
  readonly performedAction?: boolean;
  readonly unchanged?: UnchangedDestination;
  readonly verifiedField?: {
    readonly role: string;
    readonly label: string;
    readonly value: string;
  };
}

interface TaskStep {
  readonly satisfiedInput?: string;
  readonly performedAction?: boolean;
  readonly action: Action;
  readonly control?: { readonly role: string; readonly label: string };
  readonly presentedDialog?: boolean;
  readonly verifiedField?: {
    readonly role: string;
    readonly label: string;
    readonly value: string;
  };
  readonly decisionMs: number;
  readonly observationMs: number;
  readonly actionMs: number;
  readonly elapsedMs: number;
  readonly observation: string;
  readonly terminalObservation?: string;
  readonly observationError?: string;
  readonly output?: string;
  readonly error?: string;
  readonly unchanged?: UnchangedDestination;
  readonly index: number;
  readonly probabilities: ActionProbabilities;
  readonly candidates?: readonly Action[];
  readonly operation?: OperationDecision;
  readonly rejectedOperations?: readonly OperationDecision[];
  readonly completion?: BinaryAnswer;
  readonly completionTarget?: BinaryAnswer;
  readonly completionCommit?: BinaryAnswer;
  readonly checks?: readonly ActionCheck[];
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
  readonly preferredSurface?: ComputerMode;
  readonly previousSurface?: Surface;
  readonly signal?: Readonly<Pick<AbortSignal, "aborted" | "throwIfAborted">>;
  readonly onStep?: (step: TaskStep) => void | Promise<void>;
}
export type { TaskStep, TaskResult, TaskOptions, ActionResult };
