/* oxlint-disable import/max-dependencies -- This orchestrator connects the separate benchmark modules. */
import { mkdir, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ReadonlyDeep } from "type-fest";
import { createModels, loadConfig } from "../../../src/app/config.ts";
import type { ArtifactManifest } from "../../../src/app/models/artifacts.ts";
import { DEFAULT_MAX_CHOICES } from "../../../src/app/models/catalog.ts";
import type { Preset } from "../../../src/app/models/catalog.ts";
import { modelName } from "../../../src/app/models/preferences.ts";
import { CodexChromeComputer } from "../../../src/computer/codex-chrome/computer.ts";
import { terminalApproval } from "../../../src/app/terminal-approval.ts";
import type { ManagedComputer } from "../../../src/computer/types.ts";
import { sourceHash } from "../provenance.ts";
import { preparedArtifact, resolveArtifacts, savedArtifacts } from "./benchmark-artifacts.ts";
import type { ArtifactSelection } from "./benchmark-artifacts.ts";
import type { ScenarioExecution } from "./benchmark-execution.ts";
import {
  ResourceLimitError,
  ensureInstalledHostStopped,
  freeDiskGiB,
  requireMemory,
} from "./benchmark-guards.ts";
import { machineProfile } from "./benchmark-machine.ts";
import { fixtureHash, recordEvidence, recordTrial } from "./benchmark-output.ts";
import { plan, selectionFromEnvironment, textPreset } from "./benchmark-plan.ts";
import { modelProvenance } from "./benchmark-provenance.ts";
import { ModelCleanupError } from "./benchmark-errors.ts";
import { BenchmarkRuntime } from "./benchmark-runtime.ts";
import { summarize } from "./benchmark-stats.ts";
import type { TrialRecord } from "./benchmark-stats.ts";
import { createBenchmarkSuite } from "./benchmark-suite.ts";
import type { StartupRecord } from "./benchmark-types.ts";

const BENCHMARK_DIRECTORY = "runs/benchmark";
const JSON_INDENT = 2;
class BenchmarkBoundaryError extends Error {
  public override readonly name = "BenchmarkBoundaryError";
}
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "The benchmark stopped without an error message.";
}
function runStatus(input: {
  readonly failure: string | undefined;
  readonly cleanupErrors: readonly string[];
  readonly failedLoads: number;
  readonly completedTrials: number;
  readonly expectedTrials: number;
}): "finished" | "partial" | "failed" {
  if (input.failure !== undefined || input.cleanupErrors.length > 0) {
    return "failed";
  }
  return input.failedLoads > 0 || input.completedTrials < input.expectedTrials
    ? "partial"
    : "finished";
}
function setModelEnvironment(input: {
  readonly decisionEndpoint: string;
  readonly textEndpoint: string;
  readonly model: Readonly<Preset>;
}): void {
  const { decisionEndpoint, textEndpoint, model } = input;
  Bun.env["SYSTEM_ONE_URL"] = decisionEndpoint;
  Bun.env["SYSTEM_ONE_MODEL"] = modelName({ source: "local", id: model.id });
  Bun.env["SYSTEM_ONE_MAX_CHOICES"] = String(model.maxChoices ?? DEFAULT_MAX_CHOICES);
  Bun.env["TEXT_MODEL_URL"] = textEndpoint;
  Bun.env["TEXT_MODEL_ID"] = modelName({ source: "local", id: textPreset().id });
}
// One loaded decision provider serves all selected task trials before it stops.
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types, max-statements, max-lines-per-function -- Keep per-model startup and trial cleanup in one scope.
async function runModel(input: {
  readonly model: Readonly<Preset>;
  readonly candidate: ReadonlyDeep<ArtifactManifest>;
  readonly runtime: BenchmarkRuntime;
  readonly computer: ManagedComputer;
  readonly expectedHashes: Map<string, string>;
  readonly scenarios: readonly ScenarioExecution[];
  readonly trialCount: number;
  readonly output: string;
  readonly paths: Readonly<ConstructorParameters<typeof BenchmarkRuntime>[0]["paths"]>;
  readonly trials: TrialRecord[];
  readonly startups: StartupRecord[];
}): Promise<void> {
  const {
    model,
    candidate,
    runtime,
    computer,
    expectedHashes,
    scenarios,
    trialCount,
    output,
    paths,
    trials,
    startups,
  } = input;
  setModelEnvironment({
    decisionEndpoint: runtime.decisionEndpoint,
    textEndpoint: runtime.textEndpoint,
    model,
  });
  const active = await runtime.startDecision(model, candidate);
  try {
    const postDecisionTextProbeMs = await runtime.probeTextAfterDecisionLoad();
    const models = createModels(loadConfig());
    const provenance = await modelProvenance({
      model,
      paths,
      serve: active.serveArguments,
      wireModel: Bun.env["SYSTEM_ONE_MODEL"] ?? "",
      maxChoices: model.maxChoices ?? DEFAULT_MAX_CHOICES,
      artifact: active.artifact,
    });
    startups.push({
      status: "ready",
      modelId: model.id,
      provenance,
      metrics: active.metrics,
      postDecisionTextProbeMs,
    });
    for (let trial = 1; trial <= trialCount; trial += 1) {
      for (const scenario of scenarios) {
        const expectedInitialHash = expectedHashes.get(scenario.id);
        // All model and browser actions are intentionally serial.
        // oxlint-disable-next-line no-await-in-loop
        const result = await scenario.run({
          modelId: model.id,
          trial,
          computer,
          models,
          ...(expectedInitialHash === undefined ? {} : { expectedInitialHash }),
        });
        if (result.record.initialStateHash !== undefined && !expectedHashes.has(scenario.id)) {
          expectedHashes.set(scenario.id, result.record.initialStateHash);
        }
        trials.push(result.record);
        // oxlint-disable-next-line no-await-in-loop
        await recordTrial(output, result.record);
        // oxlint-disable-next-line no-await-in-loop
        await recordEvidence(output, result);
        // Memory checks are outside timed task execution.
        // oxlint-disable-next-line no-await-in-loop
        await requireMemory("after");
        if (result.stopMatrix) {
          throw new BenchmarkBoundaryError("The browser left the disposable localhost origin.");
        }
      }
    }
  } finally {
    await runtime.stopDecision();
  }
}
// Trial arrays are append-only output for the serial matrix.
// oxlint-disable-next-line typescript/prefer-readonly-parameter-types
async function runPreset(input: {
  readonly model: Readonly<Preset>;
  readonly prepared: readonly ArtifactSelection[];
  readonly runtime: BenchmarkRuntime;
  readonly computer: ManagedComputer;
  readonly expectedHashes: Map<string, string>;
  readonly scenarios: readonly ScenarioExecution[];
  readonly trialCount: number;
  readonly output: string;
  readonly paths: Readonly<ConstructorParameters<typeof BenchmarkRuntime>[0]["paths"]>;
  readonly trials: TrialRecord[];
  readonly startups: StartupRecord[];
}): Promise<void> {
  const {
    model,
    prepared,
    runtime,
    computer,
    expectedHashes,
    scenarios,
    trialCount,
    output,
    paths,
    trials,
    startups,
  } = input;
  const candidate = preparedArtifact(prepared, model);
  if (candidate === undefined) {
    const reason = prepared.find((item) => item.modelId === model.id);
    startups.push({
      status: "load-failed",
      modelId: model.id,
      reason:
        reason?.status === "lookup-failed" ? reason.reason : "No latest artifact is available.",
      at: new Date().toISOString(),
    });
    return;
  }
  try {
    await runModel({
      model,
      candidate,
      runtime,
      computer,
      expectedHashes,
      scenarios,
      trialCount,
      output,
      paths,
      trials,
      startups,
    });
  } catch (error) {
    if (
      error instanceof ResourceLimitError ||
      error instanceof BenchmarkBoundaryError ||
      error instanceof ModelCleanupError ||
      startups.some((record) => record.modelId === model.id && record.status === "ready")
    ) {
      throw error;
    }
    startups.push({
      status: "load-failed",
      modelId: model.id,
      reason: errorText(error),
      at: new Date().toISOString(),
    });
  }
}
// The source harness runs one provider and one disposable browser trial at a time.
// oxlint-disable-next-line max-statements, max-lines-per-function -- The runner retains startup and cleanup in one scope.
async function runBenchmark(): Promise<void> {
  await ensureInstalledHostStopped();
  const runId = crypto.randomUUID();
  const output = path.join(BENCHMARK_DIRECTORY, runId);
  await mkdir(output, { recursive: true });
  const data = await mkdtemp(path.join(os.tmpdir(), "s1bench-"));
  const paths = {
    integrations: path.resolve("integrations"),
    data,
    uv: Bun.which("uv") ?? "uv",
  };
  const initialDiskFreeGiB = await freeDiskGiB(data);
  const runtime = new BenchmarkRuntime({ paths, output, initialDiskFreeGiB });
  const computer = new CodexChromeComputer({ approval: terminalApproval });
  const expectedHashes = new Map<string, string>();
  const trials: TrialRecord[] = [];
  const startups: StartupRecord[] = [];
  const selection = selectionFromEnvironment();
  const { models: presets, scenarios, trialCount } = selection;
  const suite = await createBenchmarkSuite(scenarios);
  const manifest = {
    runId,
    sourceHash: await sourceHash(),
    fixtureHash: await fixtureHash(),
    startedAt: new Date().toISOString(),
    plan: plan(selection),
    host: await machineProfile(),
    runtimeScope:
      "source bridge over private Unix sockets and owned Codex Chrome tab; installed app preferences unchanged",
    fixtureOrigin: suite.origin,
    ...(suite.variantMetadata === undefined
      ? {}
      : {
          variantConfigSha256: suite.variantMetadata.configSha256,
          variantTasks: suite.variantMetadata.tasks,
        }),
  };
  await Bun.write(
    path.join(output, "manifest.json"),
    JSON.stringify(manifest, undefined, JSON_INDENT),
  );
  let failure: string | undefined = undefined;
  let cleanupFailure: string | undefined = undefined;
  try {
    await runtime.prepare();
    await computer.desktop();
    const initial = await computer.window();
    if (initial.url !== "about:blank") {
      throw new Error("The owned Codex Chrome tab context did not start on a blank page.");
    }
    const snapshotPath = Bun.env["BENCHMARK_ARTIFACT_SNAPSHOT"];
    const saved =
      snapshotPath === undefined
        ? undefined
        : await savedArtifacts({ path: snapshotPath, models: [...presets, textPreset()] });
    const prepared = saved?.selections ?? (await resolveArtifacts([...presets, textPreset()]));
    await Bun.write(
      path.join(output, "manifest.json"),
      JSON.stringify(
        {
          ...manifest,
          preparedArtifacts: prepared,
          ...(saved === undefined ? {} : { artifactSnapshotSha256: saved.sha256 }),
        },
        undefined,
        JSON_INDENT,
      ),
    );
    const textModel = textPreset();
    const textCandidate = preparedArtifact(prepared, textModel);
    if (textCandidate === undefined) {
      throw new Error("Could not resolve the fixed Qwen text artifact before the matrix.");
    }
    const textMetrics = await runtime.startText(textModel, textCandidate);
    const { textArtifact, textServeArguments: textServe } = runtime;
    if (textArtifact === undefined || textServe === undefined) {
      throw new Error("Text provider started without recorded artifact provenance.");
    }
    startups.push({
      status: "ready",
      modelId: textModel.id,
      provenance: await modelProvenance({
        model: textModel,
        paths,
        serve: textServe,
        wireModel: modelName({ source: "local", id: textModel.id }),
        artifact: textArtifact,
      }),
      metrics: textMetrics,
    });
    for (const model of presets) {
      // Decision providers share the GPU/CPU and must run one at a time.
      // oxlint-disable-next-line no-await-in-loop
      await runPreset({
        model,
        prepared,
        runtime,
        computer,
        expectedHashes,
        scenarios: suite.executions,
        trialCount,
        output,
        paths,
        trials,
        startups,
      });
    }
  } catch (error) {
    failure = errorText(error);
    throw error;
  } finally {
    const cleanup = await Promise.allSettled([suite.close(), computer.close(), runtime.close()]);
    const cleanupErrors = cleanup.flatMap((result) =>
      result.status === "rejected" ? [errorText(result.reason)] : [],
    );
    if (cleanupErrors.length > 0) {
      cleanupFailure = "Benchmark cleanup failed; inspect run-status.json before starting the app.";
    }
    const failedLoads = startups.filter((record) => record.status === "load-failed").length;
    const expectedTrials = presets.length * scenarios.length * trialCount;
    await Bun.write(
      path.join(output, "startup.json"),
      JSON.stringify(startups, undefined, JSON_INDENT),
    );
    await Bun.write(
      path.join(output, "summary.json"),
      JSON.stringify(
        presets.map((model) => summarize(model.id, trials)),
        undefined,
        JSON_INDENT,
      ),
    );
    await Bun.write(
      path.join(output, "run-status.json"),
      JSON.stringify(
        {
          status: runStatus({
            failure,
            cleanupErrors,
            failedLoads,
            completedTrials: trials.length,
            expectedTrials,
          }),
          ...(failure === undefined ? {} : { reason: failure }),
          cleanupErrors,
          failedLoads,
          completedTrials: trials.length,
          expectedTrials,
          endedAt: new Date().toISOString(),
        },
        undefined,
        JSON_INDENT,
      ),
    );
    if (cleanupErrors.length > 0) {
      console.error(JSON.stringify({ runId, cleanupErrors }));
    }
  }
  if (cleanupFailure !== undefined) {
    throw new Error(cleanupFailure);
  }
  if (startups.some((record) => record.status === "load-failed")) {
    throw new Error("Benchmark is partial because at least one preset did not load.");
  }
  console.log(JSON.stringify({ runId, output, trials: trials.length }));
}
export { runBenchmark };
