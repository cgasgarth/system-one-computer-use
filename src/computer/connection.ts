import { Client } from "@modelcontextprotocol/client";
import type { CallToolRequestParams } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { z } from "zod";
import type { ReadonlyDeep } from "type-fest";
import { desktopSchema, windowSchema } from "../agent/contracts.ts";
import type { Desktop, Window } from "../agent/contracts.ts";
import type { ClickAction, KeyAction, TypeAction } from "./types.ts";
import { CuaError } from "./errors.ts";

const ERROR_DETAIL_LIMIT = 800;
const MAX_ELEMENTS = 150;
const acceptedStatus = z
  .string()
  .refine(
    (status) => !["refused", "failed", "error"].includes(status),
    "CUA rejected the operation",
  )
  .optional();
const resultStatus = z.object({ effect: acceptedStatus, status: acceptedStatus });
const nativeWindowsSchema = z.object({
  windows: z.array(desktopSchema.shape.windows.element.extend({ layer: z.number() })),
});
const launchedSchema = z.object({ pid: z.number().int().positive() });
const unavailableWindowSchema = z.object({
  degraded_reason: z.string(),
  pid: z.number().int(),
  window_id: z.number().int(),
});
const observedWindowSchema = z.union([windowSchema, unavailableWindowSchema]);
const WINDOW_ATTEMPTS = 15;
const WINDOW_SETTLE_MS = 100;
const cursorDisabledSchema = z.object({ enabled: z.literal(false), session: z.string() });
const sessionSchema = z.object({ active: z.literal(true), session: z.string() });

class CuaConnection {
  private readonly binary: string;
  private readonly client = new Client({ name: "system-one-computer-use", version: "0.1.0" });
  private connected: Promise<void> | undefined = undefined;
  private readonly session = `system-one-${crypto.randomUUID()}`;
  private cursorReady: Promise<void> | undefined = undefined;
  private activeWindow: string | undefined = undefined;

  public constructor(binary = "cua-driver") {
    this.binary = binary;
  }

  private async invoke<Result>(
    request: ReadonlyDeep<CallToolRequestParams>,
    schema: z.ZodType<Result>,
  ): Promise<Result> {
    this.connected ??= this.client.connect(
      new StdioClientTransport({ args: ["mcp"], command: this.binary }),
    );
    await this.connected;
    const result = await this.client.callTool(request);
    if (result.isError === true) {
      const detail = result.content
        .filter((item) => item.type === "text")
        .map((item) => item.text)
        .join(" ");
      throw new CuaError(`Cua ${request.name} failed: ${detail.slice(0, ERROR_DETAIL_LIMIT)}`);
    }
    const parsed = resultStatus.and(schema).safeParse(result.structuredContent);
    if (!parsed.success) {
      throw new CuaError(`Cua ${request.name}: ${parsed.error.message}`);
    }
    return parsed.data;
  }

  public async close(): Promise<void> {
    if (this.connected !== undefined) {
      await this.client.close();
    }
  }

  private async prepareCursor(): Promise<void> {
    await this.invoke(
      { name: "start_session", arguments: { session: this.session } },
      sessionSchema,
    );
    await this.invoke(
      { name: "set_agent_cursor_enabled", arguments: { session: this.session, enabled: false } },
      cursorDisabledSchema,
    );
  }

  public async desktop(): Promise<Desktop> {
    const [desktop, all] = await Promise.all([
      this.invoke({ name: "get_accessibility_tree" }, desktopSchema),
      this.invoke({ name: "list_windows" }, nativeWindowsSchema),
    ]);
    return {
      ...desktop,
      windows: all.windows.filter((window) => window.layer === 0 && window.title.length > 0),
    };
  }

  public async window(pid: number, windowId: number): Promise<Window> {
    this.cursorReady ??= this.prepareCursor();
    await this.cursorReady;
    const target = `${pid}:${windowId}`;
    if (target !== this.activeWindow) {
      await this.invoke(
        { name: "bring_to_front", arguments: { pid, window_id: windowId } },
        resultStatus,
      );
      this.activeWindow = target;
    }
    return this.readWindow(pid, windowId, WINDOW_ATTEMPTS);
  }

  private async readWindow(pid: number, windowId: number, attempts: number): Promise<Window> {
    const state = await this.invoke(
      {
        name: "get_window_state",
        arguments: {
          include_screenshot: false,
          max_elements: MAX_ELEMENTS,
          pid,
          window_id: windowId,
          session: this.session,
        },
      },
      observedWindowSchema,
    );
    if (!("degraded_reason" in state)) {
      return state;
    }
    if (!state.degraded_reason.startsWith("ax_window_unresolved") || attempts <= 1) {
      throw new CuaError(`Cannot read this window: ${state.degraded_reason}`);
    }
    if (attempts === WINDOW_ATTEMPTS) {
      await this.invoke(
        { name: "bring_to_front", arguments: { pid, window_id: windowId } },
        resultStatus,
      );
    }
    await Bun.sleep(WINDOW_SETTLE_MS);
    return this.readWindow(pid, windowId, attempts - 1);
  }

  public async launchApp(name: string): Promise<void> {
    const app = await this.invoke({ arguments: { name }, name: "launch_app" }, launchedSchema);
    const windows = await this.invoke({ name: "list_windows" }, nativeWindowsSchema);
    const eligible = windows.windows.filter(
      (window) => window.pid === app.pid && window.layer === 0,
    );
    const [window] = eligible;
    if (eligible.length === 1 && window !== undefined) {
      await this.invoke(
        { name: "bring_to_front", arguments: { pid: app.pid, window_id: window.window_id } },
        resultStatus,
      );
    }
  }

  public async click(action: ClickAction): Promise<void> {
    const { element_token, pid, window_id } = action;
    await this.invoke(
      { arguments: { element_token, pid, window_id, session: this.session }, name: "click" },
      resultStatus,
    );
  }

  public async typeText(action: TypeAction): Promise<void> {
    const { element_token, pid, text, window_id } = action;
    await this.invoke(
      {
        arguments: { element_token, pid, text, window_id, session: this.session },
        name: "type_text",
      },
      resultStatus,
    );
  }

  public async pressKey(action: KeyAction): Promise<void> {
    const { key, modifiers, pid, window_id } = action;
    await this.invoke(
      { arguments: { key, modifiers, pid, window_id, session: this.session }, name: "press_key" },
      resultStatus,
    );
  }
}

export { CuaConnection };
