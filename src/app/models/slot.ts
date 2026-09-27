import path from "node:path";
import { chmod } from "node:fs/promises";
import type { ReadonlyDeep } from "type-fest";
import { preset } from "./catalog.ts";
import type { ModelRole, ModelSelection } from "./catalog.ts";
import { commands } from "./commands.ts";
import type { RuntimePaths } from "./commands.ts";
import { startProcess } from "./process.ts";
import type { ModelProcess } from "./process.ts";
import { verifySocketReady } from "./ready.ts";
import { clearStaleSocket } from "./sockets.ts";

const STARTUP_TIMEOUT_MS = 180_000;
const PRIVATE_SOCKET = 0o600;
type ModelCommand = ReturnType<typeof commands>;
type LoadState = "unloaded" | "downloading" | "loading" | "ready" | "error";
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
  public constructor(options: {
    readonly role: ModelRole;
    readonly selection: ModelSelection;
    readonly socketPath: string;
    readonly paths: RuntimePaths;
    readonly changed: () => void;
  }) {
    this.role = options.role;
    this.selection = options.selection;
    this.socketPath = options.socketPath;
    this.paths = options.paths;
    this.changed = options.changed;
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
  private async loadTracked(): Promise<void> {
    this.assertOpen();
    this.abort = new AbortController();
    try {
      await this.load();
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
  private async load(): Promise<void> {
    if (this.selection.source === "endpoint") {
      this.update("ready", "Using external endpoint");
      return;
    }
    const model = preset(this.selection.id);
    if (model.role !== this.role) {
      throw new Error("This model does not support the selected role");
    }
    const command = commands(model, this.socketPath, this.paths);
    const log = path.join(this.paths.data, "logs", `${model.id}.log`);
    await this.download(command, log, model.name);
    this.abort.signal.throwIfAborted();
    await this.serve(command, log, model.name);
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
    this.update("ready", `${name} is ready`);
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
