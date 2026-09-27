import { runTask } from "../../../src/agent/loop.ts";
import { ZodError } from "zod";
import type { TaskStep } from "../../../src/agent/types.ts";
import type { Models } from "./benchmark-types.ts";
import type { ManagedComputer } from "../../../src/computer/types.ts";
import type { DecisionRequestEvent } from "../../../src/models/decision-request.ts";
import { restrictedBrowser } from "../restricted-browser.ts";
import { startWorkspace } from "../workspace.ts";
import { excessWrites, grade, subtractWrites, writeCounts } from "./benchmark-cases.ts";
import type { BenchmarkCase, FailureKind, WriteCounts } from "./benchmark-cases.ts";
import type { Outcome, TrialRecord } from "./benchmark-stats.ts";

const TASK_TIMEOUT_MS = 60_000;
const CAPACITY_CODES = [
  "capacity_option_tokens:",
  "capacity_question_tokens:",
  "capacity_state_tokens:",
] as const;
interface TrialInput {
  readonly modelId: string;
  readonly trial: number;
  readonly scenario: Readonly<BenchmarkCase>;
  readonly computer: ManagedComputer;
  readonly models: Readonly<Models>;
}
interface TrialOutcome {
  readonly record: TrialRecord;
  readonly stopMatrix: boolean;
  readonly trace: readonly TaskStep[];
  readonly decisionEvents: readonly DecisionRequestEvent[];
}
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "The browser trial failed.";
}
function originEscape(message: string): boolean {
  return (
    message.includes("outside the disposable localhost fixture") ||
    message.includes("left the disposable localhost fixture")
  );
}
function errorOutcome(error: unknown): Outcome {
  const message = errorText(error);
  if (error instanceof ZodError) {
    return "format";
  }
  if (
    CAPACITY_CODES.some((code) => message.includes(code)) ||
    message.includes("supports at most")
  ) {
    return "capacity";
  }
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return "timeout";
  }
  if (message.includes("benchmark task timeout") || message.includes("timed out")) {
    return "timeout";
  }
  return message.includes("fixture") || message.includes("browser")
    ? "driver-error"
    : "model-error";
}
function resultOutcome(passed: boolean, failure: FailureKind | undefined): Outcome {
  if (passed) {
    return "success";
  }
  if (failure === "status") {
    return "blocked";
  }
  return failure ?? "wrong-result";
}
function textTiming(
  models: Readonly<Models>,
  recordElapsed: (elapsedMs: number) => void,
  onStart: () => void,
): Models["text"] {
  return {
    async generate(input) {
      onStart();
      const started = performance.now();
      const result = await models.text.generate(input);
      recordElapsed(performance.now() - started);
      return result;
    },
  };
}
// Each trial gets new in-memory data. A model can only act within this localhost origin.
// oxlint-disable-next-line max-statements, max-lines-per-function -- The trial owns the fixture and its final write audit.
async function runTrial(input: Readonly<TrialInput>): Promise<TrialOutcome> {
  const { modelId, trial, scenario, computer, models } = input;
  const workspace = startWorkspace();
  const browser = restrictedBrowser(computer, workspace.origin);
  const before = writeCounts(workspace);
  const steps: TaskStep[] = [];
  const requests: DecisionRequestEvent[] = [];
  const textTimes: number[] = [];
  let textRequests = 0;
  const startedAt = new Date().toISOString();
  let taskStarted: number | undefined = undefined;
  let taskMs = 0;
  let outcome: Outcome = "model-error";
  let errorMessage: string | undefined = undefined;
  let stopMatrix = false;
  try {
    await browser.navigate?.(`${workspace.origin}${scenario.start}`);
    taskStarted = performance.now();
    const result = await runTask({
      task: scenario.task,
      context: "",
      preferredSurface: "browser",
      applications: [],
      decision: models.decision,
      text: textTiming(
        models,
        (elapsedMs) => {
          textTimes.push(elapsedMs);
        },
        () => {
          textRequests += 1;
        },
      ),
      signal: AbortSignal.timeout(TASK_TIMEOUT_MS),
      computer(mode) {
        if (mode !== "browser") {
          throw new Error("The benchmark allows only its disposable browser fixture.");
        }
        return browser;
      },
      onStep(step) {
        steps.push(step);
        if (step.error !== undefined && originEscape(step.error)) {
          throw new Error(step.error);
        }
        const writes = subtractWrites(writeCounts(workspace), before);
        if (excessWrites(writes, scenario.expectedWrites)) {
          throw new Error("The fixture received an unintended persistent write.");
        }
      },
      onDecisionRequest(event) {
        requests.push(event);
      },
    });
    taskMs = performance.now() - taskStarted;
    const writes = subtractWrites(writeCounts(workspace), before);
    const final = await browser.window(0, 0);
    const resultGrade = grade({
      scenario,
      workspace,
      window: final,
      status: result.status,
      writes,
    });
    outcome = resultOutcome(resultGrade.passed, resultGrade.failure);
    if (result.status === "blocked") {
      const failedStep = steps.findLast((step) => step.error !== undefined);
      if (failedStep?.error !== undefined) {
        const failedOutcome = errorOutcome(new Error(failedStep.error));
        if (failedOutcome === "capacity" || failedOutcome === "timeout") {
          outcome = failedOutcome;
          errorMessage = failedStep.error;
        }
      }
    }
  } catch (error) {
    errorMessage = errorText(error);
    outcome = errorOutcome(error);
    if (taskStarted !== undefined && taskMs === 0) {
      taskMs = performance.now() - taskStarted;
    }
    stopMatrix = originEscape(errorMessage);
  } finally {
    const writes = subtractWrites(writeCounts(workspace), before);
    if (excessWrites(writes, scenario.expectedWrites)) {
      outcome = "unintended-write";
    }
    await workspace.close();
  }
  const writeDelta: WriteCounts = subtractWrites(writeCounts(workspace), before);
  const completedRequests = requests.filter((event) => event.status === "ok");
  return {
    stopMatrix,
    trace: steps,
    decisionEvents: requests,
    record: {
      modelId,
      caseId: scenario.id,
      trial,
      outcome,
      taskMs,
      turns: steps.length,
      decisionRequests: requests.filter((event) => event.status === "start").length,
      completedDecisionRequestMs: completedRequests.flatMap((event) =>
        event.elapsedMs === undefined ? [] : [event.elapsedMs],
      ),
      textRequests,
      completedTextRequestMs: textTimes,
      writeDelta,
      startedAt,
      endedAt: new Date().toISOString(),
      ...(errorMessage === undefined ? {} : { error: errorMessage }),
    },
  };
}
export { runTrial };
export type { TrialOutcome };
