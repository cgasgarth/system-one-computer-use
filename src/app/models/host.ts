import { catalog, preset } from "./catalog.ts";
import type { ModelPreferences } from "./catalog.ts";
import { hasNewerArtifacts, latestManifest, readManifest } from "./artifacts.ts";
import type { RuntimePaths } from "./commands.ts";
import { ModelSlot } from "./slot.ts";
import { modelName, writePreferences } from "./preferences.ts";
import { prepareSocketDirectory, socketPaths } from "./sockets.ts";
import type { SocketPaths } from "./sockets.ts";
import { forwardRequest } from "./forward.ts";
import { TextPrefill } from "./text-prefill.ts";

const IDLE_MS = 300_000;
interface HostOptions {
  readonly paths: RuntimePaths;
  readonly preferences: ModelPreferences;
}
interface UpdateStatus {
  readonly id: string;
  readonly state: "current" | "available" | "unknown";
  readonly message: string;
}
class ModelHost {
  public readonly decision: ModelSlot;
  public readonly text: ModelSlot;
  public readonly sockets: SocketPaths;
  private preferences: ModelPreferences;
  private timer: ReturnType<typeof setTimeout> | undefined = undefined;
  private held = false;
  private prewarming = false;
  private closed = false;
  private closing: Promise<void> | undefined = undefined;
  private activeRequests = 0;
  private updating = false;
  private updateGeneration = 0;
  private updates: readonly UpdateStatus[] = [];
  private readonly updateAbort = new AbortController();
  private readonly data: string;
  private readonly textPrefill: TextPrefill;
  public constructor(options: HostOptions) {
    this.data = options.paths.data;
    this.preferences = options.preferences;
    this.sockets = socketPaths(options.paths.data);
    this.decision = new ModelSlot({
      role: "decision",
      selection: options.preferences.decision,
      socketPath: this.sockets.decision,
      paths: options.paths,
      changed: (): void => {
        this.snapshot();
      },
    });
    this.text = new ModelSlot({
      role: "text",
      selection: options.preferences.text,
      socketPath: this.sockets.text,
      paths: options.paths,
      changed: (): void => {
        this.snapshot();
      },
    });
    this.textPrefill = new TextPrefill({ socketPath: this.sockets.text });
  }
  public snapshot(): void {
    if (this.closed) {
      return;
    }
    console.log(
      JSON.stringify({
        event: "status",
        preferences: this.preferences,
        catalog,
        models: [this.decision.status(), this.text.status()],
        updates: this.updates,
      }),
    );
  }
  public async boot(): Promise<void> {
    this.assertOpen();
    await prepareSocketDirectory(this.sockets);
    this.assertOpen();
    await writePreferences(this.preferences, this.sockets);
    this.assertOpen();
    this.snapshot();
    this.schedule();
  }
  public async configure(preferences: Readonly<ModelPreferences>): Promise<void> {
    this.assertOpen();
    this.textPrefill.cancel();
    clearTimeout(this.timer);
    try {
      this.preferences = preferences;
      await ModelHost.select(this.decision, preferences.decision);
      this.assertOpen();
      await ModelHost.select(this.text, preferences.text);
      this.assertOpen();
      await writePreferences(preferences, this.sockets);
      this.assertOpen();
      this.snapshot();
      await this.decision.ensure();
      this.assertOpen();
      await this.text.ensure();
      this.assertOpen();
      void this.checkUpdates();
    } finally {
      this.schedule();
    }
  }
  private static async select(
    slot: Readonly<ModelSlot>,
    selection: ModelSlot["selection"],
  ): Promise<void> {
    if (JSON.stringify(slot.selection) === JSON.stringify(selection)) {
      return;
    }
    await slot.unload();
    slot.select(selection);
  }
  public async warm(): Promise<void> {
    this.assertOpen();
    clearTimeout(this.timer);
    this.prewarming = true;
    let warmed = false;
    try {
      await this.decision.ensure();
      this.assertOpen();
      await this.text.ensure();
      this.assertOpen();
      warmed = true;
      console.log(JSON.stringify({ event: "warmed" }));
      if (
        this.text.selection.source === "local" &&
        !this.held &&
        this.activeRequests === 0 &&
        !this.updating
      ) {
        void this.textPrefill.start(this.text.generation, modelName(this.text.selection));
      }
    } finally {
      if (!warmed) {
        this.prewarming = false;
      }
      this.schedule();
    }
  }
  public async prepare(requestId: string): Promise<void> {
    this.assertOpen();
    this.textPrefill.cancel();
    const wasHeld = this.held;
    this.held = true;
    this.prewarming = false;
    clearTimeout(this.timer);
    let prepared = false;
    try {
      await this.decision.ensure();
      this.assertOpen();
      await this.text.ensure();
      this.assertOpen();
      prepared = true;
      console.log(JSON.stringify({ event: "prepared", requestId }));
    } finally {
      if (!prepared) {
        this.held = wasHeld;
        this.schedule();
      }
    }
  }
  public release(): void {
    if (this.closed) {
      return;
    }
    this.held = false;
    this.schedule();
  }
  public async checkUpdates(): Promise<void> {
    this.updateGeneration += 1;
    const generation = this.updateGeneration;
    const results = await Promise.all(
      catalog.map(async (model): Promise<UpdateStatus | undefined> => {
        try {
          const current = await readManifest(this.data, model);
          if (current === undefined) {
            return undefined;
          }
          const latest = await latestManifest(model, fetch, this.updateAbort.signal);
          return {
            id: model.id,
            state: hasNewerArtifacts(current, latest) ? "available" : "current",
            message: hasNewerArtifacts(current, latest)
              ? "A newer model is available."
              : "Model files are current.",
          };
        } catch {
          return { id: model.id, state: "unknown", message: "Could not check for updates." };
        }
      }),
    );
    if (this.closed || generation !== this.updateGeneration) {
      return;
    }
    this.updates = results.filter((item): item is UpdateStatus => item !== undefined);
    this.snapshot();
  }
  public async updateModel(role: "decision" | "text"): Promise<void> {
    this.reserveUpdate();
    try {
      const slot = this[role];
      if (slot.selection.source !== "local") {
        throw new Error("External model endpoints cannot be updated by this app.");
      }
      const selected = preset(slot.selection.id);
      this.updates = this.updates.filter((update) => update.id !== selected.id);
      this.snapshot();
      try {
        await slot.updateLatest();
      } catch (error) {
        await this.checkUpdates();
        throw error;
      }
      this.assertOpen();
      await this.checkUpdates();
    } finally {
      this.updating = false;
      this.schedule();
    }
  }
  private reserveUpdate(): void {
    this.assertOpen();
    if (this.held || this.activeRequests > 0 || this.updating) {
      throw new Error("Stop the current task before updating a model.");
    }
    this.textPrefill.cancel();
    this.updating = true;
    clearTimeout(this.timer);
  }
  private schedule(): void {
    clearTimeout(this.timer);
    if (
      this.closed ||
      this.held ||
      this.updating ||
      this.activeRequests > 0 ||
      this.preferences.retention === "warm"
    ) {
      return;
    }
    this.timer = setTimeout(
      () => {
        void this.unloadIdle();
      },
      this.preferences.retention === "cold" && !this.prewarming ? 0 : IDLE_MS,
    );
  }
  private async unloadIdle(): Promise<void> {
    if (this.held || this.activeRequests > 0) {
      return;
    }
    this.textPrefill.cancel();
    try {
      await this.decision.unload();
      await this.text.unload();
    } catch (error) {
      if (!this.closed) {
        ModelHost.report(error);
      }
    }
  }
  public async forward(
    request: Parameters<typeof forwardRequest>[1],
    signal: Readonly<AbortSignal>,
  ): ReturnType<typeof forwardRequest> {
    this.assertOpen();
    if (this.updating) {
      throw new Error("A model update is in progress. Retry the request after it finishes.");
    }
    this.textPrefill.cancel();
    this.activeRequests += 1;
    clearTimeout(this.timer);
    try {
      const slot = this[request.role];
      await slot.ensure();
      this.assertOpen();
      signal.throwIfAborted();
      return await forwardRequest(slot, request, signal);
    } finally {
      this.activeRequests -= 1;
      this.schedule();
    }
  }
  public static report(error: unknown): void {
    console.log(
      JSON.stringify({
        event: "error",
        message: error instanceof Error ? error.message : "Model operation failed",
      }),
    );
  }
  public async close(): Promise<void> {
    if (this.closing !== undefined) {
      return this.closing;
    }
    this.closed = true;
    this.updateAbort.abort();
    this.textPrefill.cancel();
    clearTimeout(this.timer);
    this.closing = this.closeSlots();
    await this.closing;
  }
  private async closeSlots(): Promise<void> {
    await Promise.all([this.decision.close(), this.text.close()]);
  }
  private assertOpen(): void {
    if (this.closed) {
      throw new Error("Model host is closed");
    }
  }
}
export { ModelHost };
