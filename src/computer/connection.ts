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
const MAX_ELEMENTS = 1000;
const MIN_WINDOW_WIDTH = 120;
const MIN_WINDOW_HEIGHT = 60;
const acceptedStatus = z
  .string()
  .refine(
    (status) => !["refused", "failed", "error"].includes(status),
    "CUA rejected the operation",
  )
  .optional();
const resultStatus = z.object({ effect: acceptedStatus, status: acceptedStatus });
const nativeWindowsSchema = z.object({
  windows: z.array(
    desktopSchema.shape.windows.element.extend({
      layer: z.number(),
      is_on_screen: z.boolean(),
      bounds: z.object({ width: z.number(), height: z.number() }),
    }),
  ),
});
const unavailableWindowSchema = z.object({
  degraded_reason: z.string(),
  pid: z.number().int(),
  window_id: z.number().int(),
});
const observedWindowSchema = z.union([windowSchema, unavailableWindowSchema]);
const cursorDisabledSchema = z.object({ enabled: z.literal(false), session: z.string() });
const sessionSchema = z.object({ active: z.literal(true), session: z.string() });
const endedSessionSchema = z.object({ active: z.literal(false), session: z.string() });
const applicationStateSchema = z.object({
  apps: z.array(z.object({ pid: z.number().int(), active: z.boolean(), running: z.boolean() })),
});
type CuaClient = Readonly<Pick<Client, "connect" | "callTool" | "close">>;

class CuaConnection {
  private readonly binary: string;
  private readonly client: CuaClient;
  private ready: Promise<void> | undefined = undefined;
  private readonly session = `system-one-${crypto.randomUUID()}`;
  private implicitStarted = false;
  private started = false;
  private closed = false;

  public constructor(
    binary = "cua-driver",
    client: CuaClient = new Client({ name: "system-one-computer-use", version: "0.1.0" }),
  ) {
    this.binary = binary;
    this.client = client;
  }

  private async invoke<Result>(
    request: ReadonlyDeep<CallToolRequestParams>,
    schema: z.ZodType<Result>,
  ): Promise<Result> {
    this.assertOpen();
    this.ready ??= this.initialize();
    await this.ready;
    this.assertOpen();
    return this.call(request, schema);
  }

  private async call<Result>(
    request: ReadonlyDeep<CallToolRequestParams>,
    schema: z.ZodType<Result>,
  ): Promise<Result> {
    const result = await this.client.callTool(request);
    if (result.isError === true) {
      const detail = result.content
        .filter((item) => item.type === "text")
        .map((item) => item.text)
        .join(" ");
      throw new CuaError(
        `Cua ${request.name} failed: ${detail.slice(0, ERROR_DETAIL_LIMIT)}`,
        detail.includes("(same_pid_keyboard_ambiguity)")
          ? "keyboard_target_ambiguous"
          : "operation_failed",
      );
    }
    const parsed = resultStatus.and(schema).safeParse(result.structuredContent);
    if (!parsed.success) {
      throw new CuaError(`Cua ${request.name}: ${parsed.error.message}`);
    }
    return parsed.data;
  }

  public async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    if (this.ready !== undefined) {
      try {
        if (this.started) {
          await this.call(
            { name: "end_session", arguments: { session: this.session } },
            endedSessionSchema,
          );
        }
      } finally {
        try {
          if (this.implicitStarted) {
            await this.call({ name: "end_session", arguments: {} }, endedSessionSchema);
          }
        } finally {
          await this.client.close();
        }
      }
    }
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new CuaError("The native task has stopped. Start a new task to reconnect.");
    }
  }

  private async initialize(): Promise<void> {
    await this.client.connect(new StdioClientTransport({ args: ["mcp"], command: this.binary }));
    this.assertOpen();
    // Discovery tools have no session argument; they use the transport's implicit session.
    await this.call({ name: "start_session", arguments: {} }, sessionSchema);
    this.implicitStarted = true;
    this.assertOpen();
    await this.call({ name: "start_session", arguments: { session: this.session } }, sessionSchema);
    this.started = true;
    this.assertOpen();
    await this.call(
      { name: "set_agent_cursor_enabled", arguments: { session: this.session, enabled: false } },
      cursorDisabledSchema,
    );
  }

  public async desktop(): Promise<Desktop> {
    const [desktop, listed] = await Promise.all([
      this.invoke({ name: "get_accessibility_tree" }, desktopSchema),
      this.invoke({ name: "list_windows" }, nativeWindowsSchema),
    ]);
    return {
      ...desktop,
      windows: listed.windows.filter(
        (window) =>
          window.layer === 0 &&
          window.title.trim().length > 0 &&
          window.bounds.width >= MIN_WINDOW_WIDTH &&
          window.bounds.height >= MIN_WINDOW_HEIGHT &&
          (window.is_on_screen ||
            desktop.windows.some(
              (accessible) =>
                accessible.pid === window.pid && accessible.window_id === window.window_id,
            )),
      ),
    };
  }

  public async window(pid: number, windowId: number): Promise<Window> {
    return this.readWindow(pid, windowId);
  }
  public async focusWindow(pid: number, windowId: number): Promise<void> {
    await this.invoke(
      { name: "bring_to_front", arguments: { pid, window_id: windowId } },
      resultStatus,
    );
  }
  public async openDocument(pid: number): Promise<void> {
    if (!(await this.isActive(pid))) {
      throw new CuaError("The selected app is not in front. Its Open command was not sent.");
    }
    await this.invoke(
      {
        name: "hotkey",
        arguments: { scope: "desktop", keys: ["cmd", "o"], session: this.session },
      },
      resultStatus,
    );
  }
  public async isActive(pid: number): Promise<boolean> {
    const state = await this.invoke({ name: "list_apps" }, applicationStateSchema);
    return state.apps.some((app) => app.pid === pid && app.active && app.running);
  }

  private async readWindow(pid: number, windowId: number): Promise<Window> {
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
    throw new CuaError(`Cannot read this window: ${state.degraded_reason}`);
  }

  public async click(action: ClickAction): Promise<void> {
    const { element_token, pid, window_id } = action;
    await this.invoke(
      {
        arguments: {
          element_token,
          pid,
          window_id,
          session: this.session,
          action: action.operation ?? "press",
        },
        name: "click",
      },
      resultStatus,
    );
  }

  public async typeText(action: TypeAction): Promise<void> {
    const { element_token, pid, text, window_id } = action;
    await this.invoke(
      {
        arguments: { element_token, pid, value: text, window_id, session: this.session },
        name: "set_value",
      },
      resultStatus,
    );
  }

  public async pressKey(action: KeyAction): Promise<void> {
    const { key, modifiers, pid, window_id } = action;
    const name = modifiers.length === 0 ? "press_key" : "hotkey";
    const args = {
      pid,
      window_id,
      session: this.session,
      ...(modifiers.length === 0 ? { key } : { keys: [...modifiers, key] }),
    };
    try {
      await this.invoke({ name, arguments: args }, resultStatus);
    } catch (error) {
      if (!(error instanceof CuaError) || error.code !== "keyboard_target_ambiguous") {
        throw error;
      }
      // CUA explicitly refuses ambiguous background delivery. Its foreground
      // Mode verifies the exact target window and restores prior focus afterward.
      await this.invoke(
        { name, arguments: { ...args, delivery_mode: "foreground" } },
        resultStatus,
      );
    }
  }
}

export { CuaConnection };
