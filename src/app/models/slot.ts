import path from "node:path";
import { preset } from "./catalog.ts";
import type { ModelRole, ModelSelection } from "./catalog.ts";
import { commands } from "./commands.ts";
import type { RuntimePaths } from "./commands.ts";
import { startProcess } from "./process.ts";
import type { ModelProcess } from "./process.ts";

const STARTUP_TIMEOUT_MS = 180_000;
const HEALTH_INTERVAL_MS = 500;
const HEALTH_TIMEOUT_MS = 1000;
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
  private state: LoadState = "unloaded";
  private message = "Not loaded";
  private readonly role: ModelRole;
  private readonly port: number;
  private readonly paths: RuntimePaths;
  private readonly changed: () => void;
  public constructor(options: {
    readonly role: ModelRole;
    readonly selection: ModelSelection;
    readonly port: number;
    readonly paths: RuntimePaths;
    readonly changed: () => void;
  }) {
    this.role = options.role;
    this.selection = options.selection;
    this.port = options.port;
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
    this.selection = selection;
  }
  public endpoint(): string {
    return this.selection.source === "endpoint"
      ? this.selection.url
      : `http://127.0.0.1:${this.port}${this.role === "decision" ? "/v1/systemone" : "/v1/chat/completions"}`;
  }
  public async ensure(): Promise<void> {
    await this.unloading;
    if (this.state === "ready") {
      return;
    }
    this.loading ??= this.loadTracked();
    await this.loading;
  }
  private async loadTracked(): Promise<void> {
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
    const command = commands(model, this.port, this.paths);
    const log = path.join(this.paths.data, "logs", `${model.id}.log`);
    this.update("downloading", `Preparing ${model.name}…`);
    this.child = await startProcess(command.download, command.environment, log);
    this.abort.signal.throwIfAborted();
    if ((await this.child.exited) !== 0) {
      throw new Error(`Download failed. See ${log}`);
    }
    this.abort.signal.throwIfAborted();
    this.update("loading", `Loading ${model.name}…`);
    this.child = await startProcess(
      command.serve,
      { ...command.environment, HF_HUB_OFFLINE: "1" },
      log,
    );
    this.abort.signal.throwIfAborted();
    const ready = this.waitUntilReady(Date.now() + STARTUP_TIMEOUT_MS);
    await Promise.race([ready, this.serverExit(this.child, log)]);
    this.update("ready", `${model.name} is ready`);
  }
  private async waitUntilReady(deadline: number): Promise<void> {
    this.abort.signal.throwIfAborted();
    try {
      const response = await fetch(`http://127.0.0.1:${this.port}/v1/models`, {
        signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(HEALTH_TIMEOUT_MS)]),
      });
      if (response.ok) {
        return;
      }
    } catch {
      /* Wait for the owned server to finish loading. */
    }
    if (Date.now() >= deadline) {
      throw new Error("Model loading timed out. Check its log and retry.");
    }
    await Bun.sleep(HEALTH_INTERVAL_MS);
    await this.waitUntilReady(deadline);
  }
  public async unload(): Promise<void> {
    this.unloading ??= this.unloadTracked();
    await this.unloading;
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
