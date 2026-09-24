import { Client } from "@modelcontextprotocol/client";
import type { CallToolRequestParams } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { z } from "zod";
import type { ReadonlyDeep } from "type-fest";
import { desktopSchema, windowSchema } from "../agent/contracts.ts";
import type { Desktop, Window } from "../agent/contracts.ts";
import {
  appsSchema,
  bindingSchema,
  pageSchema,
  preparedSchema,
  windowsSchema,
} from "./browser-schema.ts";
import type {
  Apps,
  BrowserBinding,
  BrowserPage,
  NativeWindow,
  NativeWindows,
  PreparedBrowser,
} from "./browser-schema.ts";
import type { BrowserTarget, ClickAction, KeyAction, TypeAction } from "./types.ts";
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

class CuaConnection {
  private readonly binary: string;
  private readonly client = new Client({ name: "system-one-computer-use", version: "0.1.0" });
  private readonly session = `system-one-browser-${crypto.randomUUID()}`;
  private connected: Promise<void> | undefined = undefined;

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

  public async desktop(): Promise<Desktop> {
    return this.invoke({ name: "get_accessibility_tree" }, desktopSchema);
  }

  public async window(pid: number, windowId: number): Promise<Window> {
    return this.invoke(
      {
        arguments: {
          include_screenshot: false,
          max_elements: MAX_ELEMENTS,
          pid,
          window_id: windowId,
        },
        name: "get_window_state",
      },
      windowSchema,
    );
  }

  public async apps(): Promise<Apps> {
    return this.invoke({ name: "list_apps" }, appsSchema);
  }

  public async windows(): Promise<NativeWindows> {
    return this.invoke({ name: "list_windows" }, windowsSchema);
  }

  public async prepareBrowser(pid: number): Promise<PreparedBrowser> {
    return this.invoke(
      {
        arguments: {
          allow_launch: true,
          pid,
          profile: { mode: "isolated_new" },
          session: this.session,
        },
        name: "browser_prepare",
      },
      preparedSchema,
    );
  }

  public async bindBrowser(window: NativeWindow): Promise<BrowserBinding> {
    return this.invoke(
      {
        arguments: {
          pid: window.pid,
          session: this.session,
          snapshot_format: "semantic_v2",
          window_id: window.window_id,
        },
        name: "get_browser_state",
      },
      bindingSchema,
    );
  }

  public async browserPage(target: BrowserTarget): Promise<BrowserPage> {
    return this.invoke(
      {
        arguments: {
          session: this.session,
          snapshot_format: "semantic_v2",
          tab_id: target.tabId,
          target_id: target.targetId,
        },
        name: "get_browser_state",
      },
      pageSchema,
    );
  }

  public async navigateBrowser(target: BrowserTarget, url: string): Promise<void> {
    await this.invoke(
      {
        arguments: { session: this.session, tab_id: target.tabId, target_id: target.targetId, url },
        name: "browser_navigate",
      },
      resultStatus,
    );
  }

  public async clickBrowser(target: BrowserTarget, action: ClickAction): Promise<void> {
    await this.invoke(
      {
        arguments: {
          input_route: "dom_event",
          ref: action.element_token,
          session: this.session,
          tab_id: target.tabId,
          target_id: target.targetId,
        },
        name: "browser_click",
      },
      resultStatus,
    );
  }

  public async typeBrowser(target: BrowserTarget, action: TypeAction): Promise<void> {
    await this.invoke(
      {
        arguments: {
          ref: action.element_token,
          replace: true,
          session: this.session,
          tab_id: target.tabId,
          target_id: target.targetId,
          text: action.text,
        },
        name: "browser_type",
      },
      resultStatus,
    );
  }

  public async launchApp(name: string): Promise<void> {
    await this.invoke({ arguments: { name }, name: "launch_app" }, resultStatus);
  }

  public async click(action: ClickAction): Promise<void> {
    const { element_token, pid, window_id } = action;
    await this.invoke(
      { arguments: { element_token, pid, window_id }, name: "click" },
      resultStatus,
    );
  }

  public async typeText(action: TypeAction): Promise<void> {
    const { element_token, pid, text, window_id } = action;
    await this.invoke(
      { arguments: { element_token, pid, text, window_id }, name: "type_text" },
      resultStatus,
    );
  }

  public async pressKey(action: KeyAction): Promise<void> {
    const { key, modifiers, pid, window_id } = action;
    await this.invoke(
      { arguments: { key, modifiers, pid, window_id }, name: "press_key" },
      resultStatus,
    );
  }
}

export { CuaConnection };
