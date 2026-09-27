import { mkdirSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import type { TaskStageEvent, TaskStep } from "../agent/types.ts";
import type { DecisionRequestEvent } from "../models/system-one.ts";
import type { ActionSelectionError } from "../models/action-selection-error.ts";
import { decisionMetrics } from "./decision-metrics.ts";
import { preferencesSchema } from "./models/catalog.ts";

const RECENT_REQUESTS = 80;
const MS_PER_SECOND = 1000;
type FailureSelection = ReturnType<ActionSelectionError["toJSON"]>;
interface ModelIdentity {
  readonly modelId: string;
  readonly endpointOrigin: string;
  readonly selection?: string;
}
interface TraceModels {
  readonly decision: ModelIdentity;
  readonly text: ModelIdentity;
}
interface RequestEvent {
  readonly source: "decision" | "text";
  readonly phase: string;
  readonly status: "start" | "ok" | "error";
  readonly candidateCount?: number;
  readonly questionCount?: number;
  readonly elapsedMs?: number;
  readonly choice?: string;
  readonly selectedProbability?: number;
  readonly answers?: DecisionRequestEvent["answers"];
  readonly atMs: number;
}
interface ActiveRequest {
  readonly source: "decision" | "text";
  readonly phase: string;
  readonly candidateCount?: number;
  readonly questionCount?: number;
  readonly started: number;
}
interface TraceDetails {
  readonly task: string;
  readonly sessionId: string | undefined;
  readonly startedAt: string;
  readonly elapsedMs: number;
  readonly stage: {
    readonly name: string;
    readonly stepIndex: number;
    readonly startedAt: string;
    readonly elapsedMs: number;
  };
  readonly model: TraceModels;
  readonly modelRequests: {
    readonly total: number;
    readonly decision: number;
    readonly text: number;
    readonly failed: number;
    readonly active:
      | {
          readonly source: "decision" | "text";
          readonly phase: string;
          readonly candidateCount?: number;
          readonly questionCount?: number;
          readonly elapsedMs: number;
          readonly startedAt: string;
        }
      | undefined;
    readonly recent: readonly RequestEvent[];
  };
}
type TraceMetrics = ReturnType<typeof decisionMetrics>;
interface TraceSnapshot extends TraceDetails, TraceMetrics {
  readonly status: "running" | "stopped" | "error";
  readonly message?: string;
  readonly decisions: number;
  readonly steps: readonly TaskStep[];
}

class TaskTrace {
  public readonly started = performance.now();
  public readonly id = `${Date.now()}-${crypto.randomUUID()}`;
  public readonly checkpointPath = `runs/inflight-${this.id}.json`;
  public readonly failurePath = `runs/failed-${this.id}.json`;
  private readonly startedAt = new Date().toISOString();
  private models: TraceModels;
  private readonly recorded: TaskStep[] = [];
  private readonly recentRequests: RequestEvent[] = [];
  private readonly decisionRequestMs: number[] = [];
  private activeRequest: ActiveRequest | undefined;
  private task = "";
  private sessionId: string | undefined;
  private stage = "preparing";
  private stepIndex = 1;
  private stageStarted = this.started;
  private decisionRequests = 0;
  private textRequests = 0;
  private failedRequests = 0;

  public constructor(models: TraceModels) {
    this.models = models;
    // A signal handler must be able to save a trace before the worker exits.
    // eslint-disable-next-line node/no-sync
    mkdirSync("runs", { recursive: true });
  }
  public get steps(): readonly TaskStep[] {
    return this.recorded;
  }
  public get taskText(): string {
    return this.task;
  }
  public get elapsedMs(): number {
    return performance.now() - this.started;
  }
  public get requestCount(): number {
    return this.decisionRequests + this.textRequests;
  }

  public begin(task: string, sessionId: string): void {
    this.task = task;
    this.sessionId = sessionId;
    this.checkpoint();
  }
  public async captureSelection(): Promise<void> {
    try {
      const file = Bun.file("models.json");
      if (!(await file.exists())) {
        return;
      }
      const parsed = preferencesSchema.safeParse(await file.json());
      if (!parsed.success) {
        return;
      }
      const { decision, text } = parsed.data;
      this.models = {
        decision: {
          ...this.models.decision,
          selection: decision.source === "local" ? decision.id : decision.model,
        },
        text: { ...this.models.text, selection: text.source === "local" ? text.id : text.model },
      };
      this.checkpoint();
    } catch {
      // Optional provenance must not prevent the requested task from running.
    }
  }
  public setStage(event: TaskStageEvent): void {
    this.stage = event.stage;
    this.stepIndex = event.stepIndex;
    this.stageStarted = performance.now();
    this.checkpoint();
  }
  public modelRequest(event: DecisionRequestEvent): void {
    this.request({ source: "decision", ...event });
  }
  public textRequest(event: Omit<RequestEvent, "source" | "atMs">): void {
    this.request({ source: "text", ...event });
  }
  private request(event: Omit<RequestEvent, "atMs">): void {
    if (event.status === "start") {
      if (event.source === "decision") {
        this.decisionRequests += 1;
      } else {
        this.textRequests += 1;
      }
      this.activeRequest = {
        source: event.source,
        phase: event.phase,
        started: performance.now(),
        ...(event.candidateCount === undefined ? {} : { candidateCount: event.candidateCount }),
        ...(event.questionCount === undefined ? {} : { questionCount: event.questionCount }),
      };
    } else {
      if (event.status === "error") {
        this.failedRequests += 1;
      }
      if (event.source === "decision" && event.elapsedMs !== undefined) {
        this.decisionRequestMs.push(event.elapsedMs);
      }
      this.activeRequest = undefined;
    }
    this.recentRequests.push({ ...event, atMs: this.elapsedMs });
    if (this.recentRequests.length > RECENT_REQUESTS) {
      this.recentRequests.shift();
    }
    this.checkpoint();
  }
  public record(step: TaskStep): void {
    this.recorded.push(step);
    this.stage = "between steps";
    this.stepIndex = step.index + 1;
    this.stageStarted = performance.now();
    this.checkpoint();
  }
  public metrics(): ReturnType<typeof decisionMetrics> {
    return decisionMetrics({
      steps: this.recorded,
      elapsedMs: this.elapsedMs,
      decisionRequestMs: this.decisionRequestMs,
    });
  }
  private details(): TraceDetails {
    return {
      task: this.task,
      sessionId: this.sessionId,
      startedAt: this.startedAt,
      elapsedMs: this.elapsedMs,
      stage: {
        name: this.stage,
        stepIndex: this.stepIndex,
        startedAt: new Date(Date.now() - (performance.now() - this.stageStarted)).toISOString(),
        elapsedMs: performance.now() - this.stageStarted,
      },
      model: this.models,
      modelRequests: {
        total: this.decisionRequests + this.textRequests,
        decision: this.decisionRequests,
        text: this.textRequests,
        failed: this.failedRequests,
        active:
          this.activeRequest === undefined
            ? undefined
            : {
                source: this.activeRequest.source,
                phase: this.activeRequest.phase,
                ...(this.activeRequest.candidateCount === undefined
                  ? {}
                  : { candidateCount: this.activeRequest.candidateCount }),
                ...(this.activeRequest.questionCount === undefined
                  ? {}
                  : { questionCount: this.activeRequest.questionCount }),
                startedAt: new Date(
                  Date.now() - (performance.now() - this.activeRequest.started),
                ).toISOString(),
                elapsedMs: performance.now() - this.activeRequest.started,
              },
        recent: this.recentRequests,
      },
    };
  }
  public snapshot(status: "running" | "stopped" | "error", message?: string): TraceSnapshot {
    return {
      status,
      ...(message === undefined ? {} : { message }),
      ...this.details(),
      decisions: this.recorded.length,
      steps: this.recorded,
      ...this.metrics(),
    };
  }
  public diagnostics(): TraceDetails & TraceMetrics & { readonly traceId: string } {
    return { traceId: this.id, ...this.details(), ...this.metrics() };
  }
  public checkpoint(): void {
    // Synchronous writes preserve the active stage if SIGTERM arrives during a model call.
    // eslint-disable-next-line node/no-sync
    writeFileSync(this.checkpointPath, JSON.stringify(this.snapshot("running")));
  }
  public saveFailure(
    status: "stopped" | "error",
    message: string,
    selectionFailure?: FailureSelection,
  ): void {
    const trace = {
      ...this.snapshot(status, message),
      ...(selectionFailure === undefined ? {} : { selectionFailure }),
    };
    // Cancellation must be persisted before the process exits.
    // eslint-disable-next-line node/no-sync
    writeFileSync(this.failurePath, JSON.stringify(trace));
  }
  public async clearCheckpoint(): Promise<void> {
    await rm(this.checkpointPath, { force: true });
  }
  public totalSeconds(): number {
    return this.elapsedMs / MS_PER_SECOND;
  }
}

export { TaskTrace };
export type { TraceModels };
