import { catalog } from "./catalog.ts";
import type { ModelPreferences } from "./catalog.ts";
import type { RuntimePaths } from "./commands.ts";
import { ModelSlot } from "./slot.ts";
import { writePreferences } from "./preferences.ts";

const DECISION_PORT = 18_700;
const TEXT_PORT = 18_800;
const IDLE_MS = 300_000;
interface HostOptions {
  readonly paths: RuntimePaths;
  readonly preferences: ModelPreferences;
}
class ModelHost {
  public readonly decision: ModelSlot;
  public readonly text: ModelSlot;
  private preferences: ModelPreferences;
  private timer: ReturnType<typeof setTimeout> | undefined = undefined;
  private held = false;
  private closed = false;
  private activeRequests = 0;
  public constructor(options: HostOptions) {
    this.preferences = options.preferences;
    this.decision = new ModelSlot({
      role: "decision",
      selection: options.preferences.decision,
      port: DECISION_PORT,
      paths: options.paths,
      changed: (): void => {
        this.snapshot();
      },
    });
    this.text = new ModelSlot({
      role: "text",
      selection: options.preferences.text,
      port: TEXT_PORT,
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
    await writePreferences(this.preferences);
    this.snapshot();
    this.schedule();
  }
  public async configure(preferences: Readonly<ModelPreferences>): Promise<void> {
    clearTimeout(this.timer);
    this.preferences = preferences;
    await ModelHost.select(this.decision, preferences.decision);
    await ModelHost.select(this.text, preferences.text);
    await writePreferences(preferences);
    this.snapshot();
    await this.decision.ensure();
    await this.text.ensure();
    this.schedule();
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
  public async prepare(requestId: string): Promise<void> {
    this.held = true;
    clearTimeout(this.timer);
    await this.decision.ensure();
    await this.text.ensure();
    console.log(JSON.stringify({ event: "prepared", requestId }));
  }
  public release(): void {
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
      this.preferences.retention === "cold" ? 0 : IDLE_MS,
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
  public async forward(request: Request, slot: Readonly<ModelSlot>): Promise<Response> {
    this.activeRequests += 1;
    clearTimeout(this.timer);
    try {
      await slot.ensure();
      const headers = new Headers(request.headers);
      headers.delete("host");
      headers.delete("content-length");
      const response = await fetch(slot.endpoint(), {
        method: request.method,
        headers,
        body: await request.arrayBuffer(),
        signal: request.signal,
      });
      const responseHeaders = new Headers(response.headers);
      responseHeaders.delete("content-encoding");
      responseHeaders.delete("content-length");
      return new Response(await response.arrayBuffer(), {
        status: response.status,
        headers: responseHeaders,
      });
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
    this.closed = true;
    clearTimeout(this.timer);
    await Promise.all([this.decision.unload(), this.text.unload()]);
  }
}
export { ModelHost };
