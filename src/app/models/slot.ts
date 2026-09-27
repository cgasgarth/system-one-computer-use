import path from "node:path";
import { chmod } from "node:fs/promises";
import type { ReadonlyDeep } from "type-fest";
import { preset } from "./catalog.ts";
import type { ModelRole, ModelSelection } from "./catalog.ts";
import { commands } from "./commands.ts";
import type { ModelCommand, RuntimePaths } from "./commands.ts";
import {
  hasNewerArtifacts,
  latestManifest,
  readBaseOutput,
  readManifest,
  resolvedBaseFingerprint,
  writeManifest,
} from "./artifacts.ts";
import type { ArtifactFetcher, ArtifactManifest } from "./artifacts.ts";
import { startProcess } from "./process.ts";
import type { ModelProcess } from "./process.ts";
import { verifySocketReady } from "./ready.ts";
import { clearStaleSocket } from "./sockets.ts";

const STARTUP_TIMEOUT_MS = 180_000;
const PRIVATE_SOCKET = 0o600;
type LoadState = "unloaded" | "downloading" | "loading" | "ready" | "error";
async function selectedBase(
  input: Readonly<{
    command: ReadonlyDeep<ModelCommand>;
    manifest: ReadonlyDeep<ArtifactManifest>;
    signal: Readonly<AbortSignal>;
    fetcher: ArtifactFetcher;
  }>,
): Promise<ArtifactManifest["base"]> {
  const { command, manifest, signal, fetcher } = input;
  if (command.baseOutput === undefined) {
    return undefined;
  }
  const declared = await readBaseOutput(command.baseOutput);
  signal.throwIfAborted();
  if (
    manifest.base?.repository === declared.repository &&
    manifest.base.revision === declared.revision &&
    manifest.base.assetFingerprint !== undefined
  ) {
    return manifest.base;
  }
  return resolvedBaseFingerprint(declared, fetcher, signal);
}
interface SlotStatus {
  readonly role: ModelRole;
  readonly state: LoadState;
  readonly message: string;
  readonly selection: ModelSelection;
}
class ModelSlot {
  public selection: ModelSelection;
  private child: ModelProcess | undefined = undefined;
  private loading: Promise<void> | undefined = undefined;
  private unloading: Promise<void> | undefined = undefined;
  private abort = new AbortController();
  private closed = false;
  private state: LoadState = "unloaded";
  private message = "Not loaded";
  private readonly role: ModelRole;
  public readonly socketPath: string;
  private readonly paths: RuntimePaths;
  private readonly changed: () => void;
  private readonly artifactFetch: ArtifactFetcher;
  public constructor(options: {
    readonly role: ModelRole;
    readonly selection: ModelSelection;
    readonly socketPath: string;
    readonly paths: RuntimePaths;
    readonly changed: () => void;
    readonly artifactFetch?: ArtifactFetcher;
  }) {
    this.role = options.role;
    this.selection = options.selection;
    this.socketPath = options.socketPath;
    this.paths = options.paths;
    this.changed = options.changed;
    this.artifactFetch = options.artifactFetch ?? fetch;
  }
  public status(): SlotStatus {
    return { role: this.role, selection: this.selection, state: this.state, message: this.message };
  }
  private update(state: LoadState, message: string): void {
    this.state = state;
    this.message = message;
    this.changed();
  }
  public select(selection: ModelSelection): void {
    this.assertOpen();
    this.selection = selection;
  }
  public async ensure(): Promise<void> {
    this.assertOpen();
    await this.unloading;
    this.assertOpen();
    if (this.state === "ready") {
      return;
    }
    this.loading ??= this.loadTracked();
    await this.loading;
  }
  public async updateLatest(): Promise<boolean> {
    this.assertOpen();
    if (this.selection.source !== "local") {
      throw new Error("External model endpoints are not managed by this app.");
    }
    if (this.loading !== undefined) {
      throw new Error("Wait for the model to finish loading before updating it.");
    }
    const model = preset(this.selection.id);
    const previous = await readManifest(this.paths.data, model);
    const latest = await latestManifest(model, this.artifactFetch, this.abort.signal);
    if (previous !== undefined && !hasNewerArtifacts(previous, latest)) {
      return false;
    }
    await this.unload();
    try {
      this.loading = this.loadTracked(latest);
      await this.loading;
    } catch (error) {
      if (previous !== undefined) {
        await this.ensure();
      }
      throw error;
    }
    return true;
  }
  private async loadTracked(candidate?: ReadonlyDeep<ArtifactManifest>): Promise<void> {
    this.assertOpen();
    this.abort = new AbortController();
    try {
      await this.load(candidate);
    } catch (error) {
      this.abort.abort();
      await this.child?.stop();
      this.update("error", error instanceof Error ? error.message : "Model loading failed");
      throw error;
    } finally {
      this.loading = undefined;
    }
  }
  private async serverExit(child: ModelProcess, log: string): Promise<never> {
    await child.exited;
    if (this.child === child) {
      this.update("error", "The model process stopped");
    }
    throw new Error(`Model stopped. See ${log}`);
  }
  private async load(candidate?: ReadonlyDeep<ArtifactManifest>): Promise<void> {
    if (this.selection.source === "endpoint") {
      this.update("ready", "Using external endpoint");
      return;
    }
    const model = preset(this.selection.id);
    if (model.role !== this.role) {
      throw new Error("This model does not support the selected role");
    }
    const manifest =
      candidate ??
      (await readManifest(this.paths.data, model)) ??
      (await latestManifest(model, this.artifactFetch, this.abort.signal));
    const command = commands({ model, socket: this.socketPath, paths: this.paths, manifest });
    const log = path.join(this.paths.data, "logs", `${model.id}.log`);
    await this.download(command, log, model.name);
    this.abort.signal.throwIfAborted();
    await this.serve(command, log, model.name);
    const base = await selectedBase({
      command,
      manifest,
      signal: this.abort.signal,
      fetcher: this.artifactFetch,
    });
    this.abort.signal.throwIfAborted();
    this.assertOpen();
    await writeManifest(
      this.paths.data,
      model,
      base === undefined ? manifest : { ...manifest, base },
      this.abort.signal,
    );
    this.abort.signal.throwIfAborted();
    this.assertOpen();
    this.update("ready", `${model.name} is ready`);
  }
  private async download(
    command: ReadonlyDeep<ModelCommand>,
    log: string,
    name: string,
  ): Promise<void> {
    this.update("downloading", `Preparing ${name}…`);
    this.child = await startProcess(command.download, command.environment, { logPath: log });
    this.abort.signal.throwIfAborted();
    if ((await this.child.exited) !== 0) {
      throw new Error(`Download failed. See ${log}`);
    }
    this.abort.signal.throwIfAborted();
  }
  private async serve(
    command: ReadonlyDeep<ModelCommand>,
    log: string,
    name: string,
  ): Promise<void> {
    this.update("loading", `Loading ${name}…`);
    await clearStaleSocket(this.socketPath);
    this.abort.signal.throwIfAborted();
    this.child = await startProcess(
      command.serve,
      { ...command.environment, HF_HUB_OFFLINE: "1" },
      {
        logPath: log,
        readiness: {
          message: command.readyMessage,
          signal: this.abort.signal,
          timeoutMs: STARTUP_TIMEOUT_MS,
        },
      },
    );
    this.abort.signal.throwIfAborted();
    await Promise.race([this.child.waitUntilReady(), this.serverExit(this.child, log)]);
    await chmod(this.socketPath, PRIVATE_SOCKET);
    await verifySocketReady({
      role: this.role,
      selection: this.selection,
      socketPath: this.socketPath,
      signal: this.abort.signal,
      timeoutMs: STARTUP_TIMEOUT_MS,
    });
  }
  public async unload(): Promise<void> {
    this.unloading ??= this.unloadTracked();
    await this.unloading;
  }
  public async close(): Promise<void> {
    this.closed = true;
    await this.unload();
  }
  private assertOpen(): void {
    if (this.closed) {
      throw new Error("Model slot is closed");
    }
  }
  private async unloadTracked(): Promise<void> {
    try {
      await this.stopLoaded();
    } finally {
      this.unloading = undefined;
    }
  }
  private async stopLoaded(): Promise<void> {
    this.abort.abort();
    const { child } = this;
    this.child = undefined;
    await child?.stop();
    await clearStaleSocket(this.socketPath);
    try {
      await this.loading;
    } catch {
      /* Cancellation has already stopped the owned process. */
    }
    this.update(
      "unloaded",
      this.selection.source === "local" ? "Downloaded · loads on next task" : "External endpoint",
    );
  }
}
export { ModelSlot };
export type { SlotStatus };
