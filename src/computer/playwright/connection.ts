import { Client } from "@modelcontextprotocol/client";
import type { CallToolRequestParams } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import type { ReadonlyDeep } from "type-fest";
import { fileURLToPath } from "node:url";
import { CuaError } from "../errors.ts";
import { chromeExecutable, extensionToken } from "./settings.ts";

const CLI = fileURLToPath(new URL("cli.js", import.meta.resolve("@playwright/mcp/package.json")));
type BrowserSessionMode = "extension" | "isolated";
interface PlaywrightConnectionOptions {
  readonly mode?: BrowserSessionMode;
  readonly extensionToken?: string | undefined;
}
function mcpArguments(mode: BrowserSessionMode): string[] {
  return [
    CLI,
    ...(mode === "extension" ? ["--extension"] : ["--headless", "--isolated"]),
    "--browser",
    "chrome",
    "--timeout-settle",
    "0",
    "--output-dir",
    "runs/playwright",
  ];
}

class PlaywrightConnection {
  private readonly client = new Client({ name: "system-one-computer-use", version: "0.1.0" });
  private readonly token: string | undefined;
  private readonly mode: BrowserSessionMode;
  private connected: Promise<void> | undefined = undefined;

  public constructor(options: PlaywrightConnectionOptions = {}) {
    this.token = options.extensionToken;
    this.mode = options.mode ?? "extension";
  }

  private async connect(): Promise<void> {
    const token = this.mode === "extension" ? await extensionToken(this.token) : undefined;
    const executable = await chromeExecutable();
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(Bun.env)) {
      if (value !== undefined) {
        env[key] = value;
      }
    }
    if (token === undefined) {
      delete env["PLAYWRIGHT_MCP_EXTENSION_TOKEN"];
    } else {
      env["PLAYWRIGHT_MCP_EXTENSION_TOKEN"] = token;
    }
    if (executable !== undefined) {
      env["PLAYWRIGHT_MCP_EXECUTABLE_PATH"] = executable;
    }
    await this.client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: mcpArguments(this.mode),
        env,
        stderr: "pipe",
      }),
    );
  }

  public async ready(): Promise<void> {
    this.connected ??= this.connect();
    await this.connected;
  }

  public async call(request: ReadonlyDeep<CallToolRequestParams>): Promise<string> {
    await this.ready();
    const result = await this.client.callTool(request);
    const text = result.content
      .filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("\n");
    if (result.isError === true || text.startsWith("### Error")) {
      throw new CuaError(`Playwright ${request.name} failed: ${text}`);
    }
    return text;
  }

  public async close(): Promise<void> {
    if (this.connected !== undefined) {
      await this.client.close();
    }
  }
}

export { PlaywrightConnection, mcpArguments };
export type { PlaywrightConnectionOptions };
