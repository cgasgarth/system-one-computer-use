import { describeAction } from "../agent/contracts.ts";
import type { TextModel } from "../models/text.ts";
import type { SessionStore, TurnHandle } from "./sessions/store.ts";
import { TaskTrace } from "./task-trace.ts";
import type { TraceModels } from "./task-trace.ts";

interface ExecutionDependencies {
  readonly identities: TraceModels;
  readonly sessions: SessionStore;
  readonly text: TextModel;
}

class WorkerExecution {
  public readonly trace: TaskTrace;
  private readonly dependencies: Readonly<ExecutionDependencies>;
  private currentHandle: TurnHandle | undefined;

  public constructor(dependencies: Readonly<ExecutionDependencies>) {
    this.dependencies = dependencies;
    this.trace = new TaskTrace(dependencies.identities);
  }
  public get steps(): TaskTrace["steps"] {
    return this.trace.steps;
  }
  public get handle(): TurnHandle | undefined {
    return this.currentHandle;
  }
  public get task(): string {
    return this.trace.taskText;
  }
  public begin(task: string, handle: TurnHandle): void {
    this.currentHandle = handle;
    this.trace.begin(task, handle.sessionId);
  }
  public async record(step: Parameters<TaskTrace["record"]>[0]): Promise<void> {
    this.trace.record(step);
    if (this.currentHandle === undefined) {
      throw new Error("The task session is unavailable while saving its step.");
    }
    await this.dependencies.sessions.update(this.currentHandle, {
      action: describeAction(step.action),
      observation: step.observation,
      ...(step.output === undefined ? {} : { message: step.output }),
    });
    this.report(step.error ?? step.observationError ?? step.output ?? describeAction(step.action));
  }
  public report(message: string): void {
    console.log(
      JSON.stringify({
        status: "running",
        message,
        decisions: this.steps.length,
        modelRequests: this.trace.requestCount,
        ...this.trace.metrics(),
      }),
    );
  }
  public textModel(): TextModel {
    return {
      generate: async (request) => {
        const started = performance.now();
        this.trace.textRequest({ phase: request.purpose, status: "start" });
        this.report("Preparing requested text…");
        try {
          const value = await this.dependencies.text.generate(request);
          this.trace.textRequest({
            phase: request.purpose,
            status: "ok",
            elapsedMs: performance.now() - started,
          });
          return value;
        } catch (error) {
          this.trace.textRequest({
            phase: request.purpose,
            status: "error",
            elapsedMs: performance.now() - started,
          });
          throw error;
        }
      },
    };
  }
  public stage(event: Parameters<TaskTrace["setStage"]>[0]): void {
    this.trace.setStage(event);
    const messages = {
      observation: "Inspecting screen…",
      decision: "Choosing the next action…",
      action: "Running selected action…",
    };
    this.report(messages[event.stage]);
  }
  public decisionRequest(event: Parameters<TaskTrace["modelRequest"]>[0]): void {
    this.trace.modelRequest(event);
    if (event.status !== "start") {
      return;
    }
    const checking =
      event.phase.startsWith("completion") ||
      event.phase.startsWith("commit") ||
      event.phase === "field-readiness";
    this.report(checking ? "Checking the current result…" : "Choosing the next action…");
  }
}

export { WorkerExecution };
