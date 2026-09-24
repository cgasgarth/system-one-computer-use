import { Client } from "@modelcontextprotocol/client";
import type { CallToolRequestParams } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import type { ReadonlyDeep } from "type-fest";
import { fileURLToPath } from "node:url";
import { CuaError } from "../errors.ts";
import { extensionToken } from "./settings.ts";

const CLI = fileURLToPath(new URL("cli.js", import.meta.resolve("@playwright/mcp/package.json")));

class PlaywrightConnection {
  private readonly client = new Client({ name: "system-one-computer-use", version: "0.1.0" });
  private readonly token: string | undefined;
  private connected: Promise<void> | undefined = undefined;

  public constructor(token?: string) {
    this.token = token;
  }

  private async connect(): Promise<void> {
    const token = await extensionToken(this.token);
    await this.client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [CLI, "--extension", "--browser", "chrome", "--output-dir", "runs/playwright"],
        env: { ...Bun.env, PLAYWRIGHT_MCP_EXTENSION_TOKEN: token },
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

export { PlaywrightConnection };
