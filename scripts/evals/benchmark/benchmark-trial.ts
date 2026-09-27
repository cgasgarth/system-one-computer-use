/* oxlint-disable import/max-dependencies -- One trial joins the local fixture, agent, grader, and trace. */
import { runTask } from "../../../src/agent/loop.ts";
import { ZodError } from "zod";
import type { TaskStep } from "../../../src/agent/types.ts";
import type { Window } from "../../../src/agent/contracts.ts";
import type { Models } from "./benchmark-types.ts";
import type { ManagedComputer } from "../../../src/computer/types.ts";
import type {
  DecisionRequestEvent,
  DecisionWireEvent,
} from "../../../src/models/decision-request.ts";
import { restrictedBrowser } from "../restricted-browser.ts";
import type { Workspace } from "../workspace.ts";
import { excessWrites, grade, subtractWrites, writeCounts } from "./benchmark-cases.ts";
import type { BenchmarkCase, FailureKind, WriteCounts } from "./benchmark-cases.ts";
import { FixtureStateError } from "./benchmark-fixture-error.ts";
import { externalTargetKind, infrastructureGrade } from "./benchmark-infrastructure.ts";
import { canonicalStart, initialStateHash } from "./benchmark-state.ts";
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
  readonly workspace: Readonly<Workspace>;
  readonly expectedInitialHash?: string;
}
interface TrialScenario {
  readonly id: string;
  readonly task: string;
  readonly start: string;
  readonly expectedWrites: WriteCounts;
}
interface TrialFixture {
  readonly origin: string;
  readonly reset: () => void;
  readonly writeCounts: () => WriteCounts;
  readonly canonicalStart: (window: Readonly<Window>) => boolean;
  readonly initialStateHash: (window: Readonly<Window>) => string;
  readonly grade: (
    window: Readonly<Window>,
    status: "complete" | "blocked",
    writes: Readonly<WriteCounts>,
  ) => { readonly passed: boolean; readonly failure?: FailureKind };
}
interface CoreTrialInput extends Omit<TrialInput, "scenario" | "workspace"> {
  readonly scenario: Readonly<TrialScenario>;
  readonly fixture: Readonly<TrialFixture>;
}
interface TrialOutcome {
  readonly record: TrialRecord;
  readonly stopMatrix: boolean;
  readonly trace: readonly TaskStep[];
  readonly decisionEvents: readonly DecisionRequestEvent[];
  readonly wireRequests: readonly {
    readonly phase: DecisionWireEvent["phase"];
    readonly bodyJson: string;
    readonly sha256: string;
  }[];
}
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "The browser trial failed.";
}
function errorOutcome(error: unknown): Outcome {
  const message = errorText(error);
  if (externalTargetKind(message) === "blocked-target") {
    return "guarded-external-target";
  }
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
async function runTrialCore(input: Readonly<CoreTrialInput>): Promise<TrialOutcome> {
  const { modelId, trial, scenario, computer, models, fixture, expectedInitialHash } = input;
  fixture.reset();
  const browser = restrictedBrowser(computer, fixture.origin);
  const before = fixture.writeCounts();
  const steps: TaskStep[] = [];
  const requests: DecisionRequestEvent[] = [];
  const wireRequests: { phase: DecisionWireEvent["phase"]; bodyJson: string; sha256: string }[] =
    [];
  const textTimes: number[] = [];
  let textRequests = 0;
  const startedAt = new Date().toISOString();
  let taskStarted: number | undefined = undefined;
  let taskMs = 0;
  let observedInitialHash: string | undefined = undefined;
  let outcome: Outcome = "model-error";
  let taskStatus: TrialRecord["taskStatus"] = "not-started";
  let errorMessage: string | undefined = undefined;
  let stopMatrix = false;
  try {
    await browser.navigate?.("about:blank");
    await browser.navigate?.(`${fixture.origin}${scenario.start}`);
    const initial = await browser.window(0, 0);
    if (!fixture.canonicalStart(initial)) {
      throw new FixtureStateError("The reset fixture did not show its canonical start state.");
    }
    observedInitialHash = fixture.initialStateHash(initial);
    if (expectedInitialHash !== undefined && observedInitialHash !== expectedInitialHash) {
      throw new FixtureStateError(
        "Fixture reset changed the initial observed state for this case.",
      );
    }
    taskStarted = performance.now();
    taskStatus = "error";
    const result = await runTask({
      task: scenario.task,
      context: "",
      preferredSurface: "browser",
      availableSurfaces: ["browser"],
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
        if (step.error !== undefined && externalTargetKind(step.error) === "observed-escape") {
          throw new Error(step.error);
        }
        const writes = subtractWrites(fixture.writeCounts(), before);
        if (excessWrites(writes, scenario.expectedWrites)) {
          throw new Error("The fixture received an unintended persistent write.");
        }
      },
      onDecisionRequest(event) {
        requests.push(event);
      },
      onDecisionWire(event) {
        const bodyJson = JSON.stringify(event.body);
        const sha256 = new Bun.CryptoHasher("sha256").update(bodyJson).digest("hex");
        wireRequests.push({ phase: event.phase, bodyJson, sha256 });
      },
    });
    taskStatus = result.status;
    taskMs = performance.now() - taskStarted;
    const writes = subtractWrites(fixture.writeCounts(), before);
    const final = await browser.window(0, 0);
    const resultGrade = fixture.grade(final, result.status, writes);
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
    stopMatrix =
      externalTargetKind(errorMessage) === "observed-escape" ||
      error instanceof FixtureStateError ||
      (taskStarted === undefined && observedInitialHash === undefined);
  } finally {
    const writes = subtractWrites(fixture.writeCounts(), before);
    if (excessWrites(writes, scenario.expectedWrites)) {
      outcome = "unintended-write";
    }
  }
  const writeDelta: WriteCounts = subtractWrites(fixture.writeCounts(), before);
  const gradedOutcome = outcome;
  const infrastructure = infrastructureGrade(gradedOutcome, steps, errorMessage);
  const guardedExternalAttempts = steps.filter(
    (step) => step.error !== undefined && externalTargetKind(step.error) === "blocked-target",
  ).length;
  const completedRequests = requests.filter((event) => event.status === "ok");
  return {
    stopMatrix,
    trace: steps,
    decisionEvents: requests,
    wireRequests,
    record: {
      modelId,
      caseId: scenario.id,
      trial,
      outcome: infrastructure.outcome,
      gradedOutcome,
      taskStatus,
      driverErrors: infrastructure.driverErrors,
      guardedExternalAttempts,
      ...(observedInitialHash === undefined ? {} : { initialStateHash: observedInitialHash }),
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
async function runTrial(input: Readonly<TrialInput>): Promise<TrialOutcome> {
  const { scenario, workspace, ...rest } = input;
  return runTrialCore({
    ...rest,
    scenario,
    fixture: {
      origin: workspace.origin,
      reset: workspace.reset,
      writeCounts: () => writeCounts(workspace),
      canonicalStart: (window) => canonicalStart({ scenario, workspace, window }),
      initialStateHash: (window) => initialStateHash(workspace, window),
      grade: (window, status, writes) => grade({ scenario, workspace, window, status, writes }),
    },
  });
}
export { runTrial, runTrialCore };
export type { TrialFixture, TrialOutcome, TrialScenario };
