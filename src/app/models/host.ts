import { catalog } from "./catalog.ts";
import type { ModelPreferences } from "./catalog.ts";
import type { RuntimePaths } from "./commands.ts";
import { ModelSlot } from "./slot.ts";
import { writePreferences } from "./preferences.ts";
import { prepareSocketDirectory, socketPaths } from "./sockets.ts";
import type { SocketPaths } from "./sockets.ts";
import { forwardRequest } from "./forward.ts";

const IDLE_MS = 300_000;
interface HostOptions {
  readonly paths: RuntimePaths;
  readonly preferences: ModelPreferences;
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
  public constructor(options: HostOptions) {
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
    } finally {
      if (!warmed) {
        this.prewarming = false;
      }
      this.schedule();
    }
  }
  public async prepare(requestId: string): Promise<void> {
    this.assertOpen();
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
  private schedule(): void {
    clearTimeout(this.timer);
    if (
      this.closed ||
      this.held ||
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
