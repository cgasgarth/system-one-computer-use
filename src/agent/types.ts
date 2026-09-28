import type { ComputerMode, ManagedComputer } from "../computer/types.ts";
import type { ActionProbabilities } from "../models/system-one-schema.ts";
import type { Decision, DecisionModel, DecisionRequestEvent } from "../models/system-one.ts";
import type { DecisionWireEvent } from "../models/decision-request.ts";
import type { TextModel, TextWireEvent } from "../models/text.ts";
import type { Action, MenuInspection, Surface } from "./contracts.ts";
import type { UnchangedDestination } from "./progress.ts";
import type { OperationDecision } from "../models/decision-context.ts";

interface ActionResult {
  readonly output: string;
  readonly menuInspection?: MenuInspection;
  readonly satisfiedInput?: string;
  readonly performedAction?: boolean;
  readonly unchanged?: UnchangedDestination;
  readonly verifiedField?: {
    readonly role: string;
    readonly label: string;
    readonly value: string;
  };
}
interface TaskStageEvent {
  readonly stage: "observation" | "decision" | "action";
  readonly stepIndex: number;
}

interface TaskStep {
  readonly satisfiedInput?: string;
  readonly performedAction?: boolean;
  readonly action: Action;
  readonly control?: { readonly role: string; readonly label: string };
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
  readonly menuInspection?: MenuInspection;
  readonly terminalDecision?: Decision;
  readonly observationError?: string;
  readonly output?: string;
  readonly error?: string;
  readonly unchanged?: UnchangedDestination;
  readonly index: number;
  readonly probabilities: ActionProbabilities;
  readonly candidates?: readonly Action[];
  readonly operation?: OperationDecision;
  readonly rejectedOperations?: readonly OperationDecision[];
}
interface TaskResult {
  readonly status: "complete" | "blocked";
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
  readonly availableSurfaces?: readonly [ComputerMode, ...ComputerMode[]];
  readonly previousSurface?: Surface;
  readonly signal?: Readonly<AbortSignal>;
  readonly onStep?: (step: TaskStep) => void | Promise<void>;
  readonly onStage?: (event: TaskStageEvent) => void | Promise<void>;
  readonly onDecisionRequest?: (event: DecisionRequestEvent) => void;
  readonly onDecisionWire?: (event: DecisionWireEvent) => void;
  readonly onTextWire?: (event: TextWireEvent) => void;
}
export type { TaskStageEvent, TaskStep, TaskResult, TaskOptions, ActionResult };
