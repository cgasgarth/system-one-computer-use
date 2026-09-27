/* oxlint-disable import/max-dependencies -- Runtime startup joins the app process, socket, and artifact modules. */
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import type { ReadonlyDeep } from "type-fest";
import {
  readBaseOutput,
  resolvedBaseFingerprint,
  writeManifest,
} from "../../../src/app/models/artifacts.ts";
import type { ArtifactManifest } from "../../../src/app/models/artifacts.ts";
import type { Preset } from "../../../src/app/models/catalog.ts";
import { commands } from "../../../src/app/models/commands.ts";
import type { RuntimePaths } from "../../../src/app/models/commands.ts";
import { modelName } from "../../../src/app/models/preferences.ts";
import { startProcess } from "../../../src/app/models/process.ts";
import type { ModelProcess } from "../../../src/app/models/process.ts";
import {
  clearStaleSocket,
  localModelEndpoint,
  prepareSocketDirectory,
  socketPaths,
} from "../../../src/app/models/sockets.ts";
import { requireDisk, requireMemory } from "./benchmark-guards.ts";
import { ModelCleanupError } from "./benchmark-errors.ts";
import { probeDecision, probeText } from "./benchmark-ready.ts";

const DOWNLOAD_TIMEOUT_MS = 600_000;
const LOAD_TIMEOUT_MS = 240_000;
interface StartupMetrics {
  readonly modelId: string;
  readonly cachePrepMs: number;
  readonly loadMs: number;
  readonly readyProbeMs: number;
  readonly baseFingerprintMs: number;
  readonly diskFreeBeforeGiB: number;
  readonly diskFreeAfterGiB: number;
  readonly memoryFreeBeforePercent: number;
  readonly memoryFreeAfterPercent: number;
}
interface ActiveDecision {
  readonly process: ModelProcess;
  readonly model: Preset;
  readonly artifact: ReadonlyDeep<ArtifactManifest>;
  readonly metrics: StartupMetrics;
  readonly serveArguments: readonly string[];
}

async function bounded<Result>(
  promise: Promise<Result>,
  milliseconds: number,
  label: string,
): Promise<Result> {
  const timeout = Promise.withResolvers<Result>();
  const timer = setTimeout(() => {
    timeout.reject(new Error(`${label} exceeded its ${milliseconds} ms benchmark startup limit.`));
  }, milliseconds);
  try {
    return await Promise.race([promise, timeout.promise]);
  } finally {
    clearTimeout(timer);
  }
}
async function stopOwned(process: Readonly<ModelProcess>, modelId: string): Promise<void> {
  try {
    await process.stop();
  } catch (error) {
    throw new ModelCleanupError(`Could not stop ${modelId} after model work.`, { cause: error });
  }
}
class BenchmarkRuntime {
  private readonly paths: RuntimePaths;
  private readonly output: string;
  private readonly initialDiskFreeGiB: number;
  private readonly sockets: ReturnType<typeof socketPaths>;
  private textProcess: ModelProcess | undefined = undefined;
  private activeDecision: ActiveDecision | undefined = undefined;
  public textStartup: StartupMetrics | undefined = undefined;
  public textArtifact: ReadonlyDeep<ArtifactManifest> | undefined = undefined;
  public textServeArguments: readonly string[] | undefined = undefined;

  public constructor(input: {
    readonly paths: RuntimePaths;
    readonly output: string;
    readonly initialDiskFreeGiB: number;
  }) {
    this.paths = input.paths;
    this.output = input.output;
    this.initialDiskFreeGiB = input.initialDiskFreeGiB;
    this.sockets = socketPaths(input.paths.data);
  }
  public get pathsForProvenance(): RuntimePaths {
    return this.paths;
  }
  public get textEndpoint(): string {
    return localModelEndpoint(this.sockets.text, "text");
  }
  public get decisionEndpoint(): string {
    return localModelEndpoint(this.sockets.decision, "decision");
  }
  public async prepare(): Promise<void> {
    await prepareSocketDirectory(this.sockets);
    await mkdir(this.output, { recursive: true });
  }
  private async download(
    model: Readonly<Preset>,
    command: ReadonlyDeep<ReturnType<typeof commands>>,
  ): Promise<number> {
    await requireDisk(this.paths.data, this.initialDiskFreeGiB);
    const started = performance.now();
    const process = await startProcess(command.download, command.environment, {
      logPath: path.join(this.output, `${model.id}-download.log`),
    });
    try {
      const code = await bounded(
        process.exited,
        DOWNLOAD_TIMEOUT_MS,
        `${model.id} cache preparation`,
      );
      if (code !== 0) {
        throw new Error(`${model.id} cache preparation failed; inspect its bounded log.`);
      }
    } finally {
      await stopOwned(process, model.id);
    }
    await requireDisk(this.paths.data, this.initialDiskFreeGiB);
    return performance.now() - started;
  }
  // Model load keeps its ready probe and error cleanup within one owned process scope.
  // oxlint-disable-next-line max-statements
  private async serve(
    model: Readonly<Preset>,
    socket: string,
    options: {
      readonly role: "decision" | "text";
      readonly candidate: ReadonlyDeep<ArtifactManifest>;
    },
  ): Promise<{
    readonly process: ModelProcess;
    readonly metrics: StartupMetrics;
    readonly serveArguments: readonly string[];
    readonly artifact: ReadonlyDeep<ArtifactManifest>;
  }> {
    const { role, candidate } = options;
    const command = commands({ model, socket, paths: this.paths, manifest: candidate });
    const diskFreeBeforeGiB = await requireDisk(this.paths.data, this.initialDiskFreeGiB);
    const memoryFreeBeforePercent = await requireMemory("before");
    await clearStaleSocket(socket);
    const cachePrepMs = await this.download(model, command);
    const started = performance.now();
    const process = await startProcess(
      command.serve,
      { ...command.environment, HF_HUB_OFFLINE: "1" },
      {
        logPath: path.join(this.output, `${model.id}-serve.log`),
        readiness: {
          message: command.readyMessage,
          signal: AbortSignal.timeout(LOAD_TIMEOUT_MS),
          timeoutMs: LOAD_TIMEOUT_MS,
        },
      },
    );
    try {
      await process.waitUntilReady();
      const loadMs = performance.now() - started;
      const probeStarted = performance.now();
      const wireModel = modelName({ source: "local", id: model.id });
      await (role === "decision" ? probeDecision(socket, wireModel) : probeText(socket, wireModel));
      const readyProbeMs = performance.now() - probeStarted;
      const baseStarted = performance.now();
      const base =
        command.baseOutput === undefined ? undefined : await readBaseOutput(command.baseOutput);
      const resolvedBase = base === undefined ? undefined : await resolvedBaseFingerprint(base);
      const baseFingerprintMs = performance.now() - baseStarted;
      const artifact =
        resolvedBase === undefined ? candidate : { ...candidate, base: resolvedBase };
      await writeManifest(this.paths.data, model, artifact);
      const metrics = {
        modelId: model.id,
        cachePrepMs,
        loadMs,
        readyProbeMs,
        baseFingerprintMs,
        diskFreeBeforeGiB,
        diskFreeAfterGiB: await requireDisk(this.paths.data, this.initialDiskFreeGiB),
        memoryFreeBeforePercent,
        memoryFreeAfterPercent: await requireMemory("after"),
      };
      return { process, metrics, serveArguments: command.serve, artifact };
    } catch (error) {
      try {
        await stopOwned(process, model.id);
        await clearStaleSocket(socket);
      } catch (cleanupError) {
        throw new ModelCleanupError(`Could not stop ${model.id} after a failed load.`, {
          cause: cleanupError,
        });
      }
      throw error;
    }
  }
  public async startText(
    model: Readonly<Preset>,
    candidate: ReadonlyDeep<ArtifactManifest>,
  ): Promise<StartupMetrics> {
    if (this.textProcess !== undefined || model.role !== "text") {
      throw new Error("The fixed text provider is already running or has the wrong role.");
    }
    const loaded = await this.serve(model, this.sockets.text, { role: "text", candidate });
    this.textProcess = loaded.process;
    this.textStartup = loaded.metrics;
    this.textArtifact = loaded.artifact;
    this.textServeArguments = loaded.serveArguments;
    return loaded.metrics;
  }
  public async startDecision(
    model: Readonly<Preset>,
    candidate: ReadonlyDeep<ArtifactManifest>,
  ): Promise<ActiveDecision> {
    if (this.activeDecision !== undefined || model.role !== "decision") {
      throw new Error("Stop the current decision model before loading another preset.");
    }
    const loaded = await this.serve(model, this.sockets.decision, { role: "decision", candidate });
    this.activeDecision = { ...loaded, model };
    return this.activeDecision;
  }
  public async stopDecision(): Promise<void> {
    const active = this.activeDecision;
    await active?.process.stop();
    this.activeDecision = undefined;
    await clearStaleSocket(this.sockets.decision);
  }
  public async close(): Promise<void> {
    const text = this.textProcess;
    const [decisionStop, textStop] = await Promise.allSettled([this.stopDecision(), text?.stop()]);
    if (textStop.status === "fulfilled") {
      this.textProcess = undefined;
      await clearStaleSocket(this.sockets.text);
    }
    if (decisionStop.status === "rejected" || textStop.status === "rejected") {
      throw new Error(
        `A benchmark model did not stop; retained its runtime at ${this.paths.data}.`,
      );
    }
    await rm(this.paths.data, { recursive: true, force: true });
  }
}

export { BenchmarkRuntime };
export type { ActiveDecision, StartupMetrics };
