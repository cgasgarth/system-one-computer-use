/* oxlint-disable typescript/prefer-readonly-parameter-types -- SDK and AbortSignal types are mutable external contracts. */
import type { CallToolResult } from "@modelcontextprotocol/server";
import { CodexControlsSession } from "./app-server.ts";
import type { AppServerOptions } from "./app-server.ts";
import type { ApprovalRequest, ApprovalResult } from "./protocol.ts";

const NATIVE_SETUP = "await cua.getState();";
const CHROME_SETUP = `var { setupBrowserRuntime } = await import("/Applications/ChatGPT.app/Contents/Resources/plugins/openai-bundled/plugins/chrome/scripts/browser-client.mjs");
var agent = await setupBrowserRuntime();
var chrome = await agent.browsers.get("chrome");
nodeRepl.write(await chrome.documentation());`;

type ApprovalRelay = (request: Readonly<ApprovalRequest>) => Promise<ApprovalResult>;
type ControlTool = "computer" | "chrome";
type ExecuteRequest = Readonly<{
  tool: ControlTool;
  code: string;
  title: string;
  relay: ApprovalRelay;
  signal?: AbortSignal;
}>;

class CodexControlsBridge {
  private session: CodexControlsSession;
  private readonly options: Readonly<AppServerOptions>;
  private nativeReady = false;
  private chromeReady = false;
  private nativeDocs: CallToolResult | undefined;
  private chromeDocs: CallToolResult | undefined;

  public constructor(options: Readonly<AppServerOptions> = {}) {
    this.options = options;
    this.session = new CodexControlsSession(options);
  }

  public async execute(request: ExecuteRequest): Promise<CallToolResult> {
    const { tool, code, title, relay, signal } = request;
    if (tool === "computer") {
      const first = !this.nativeReady;
      if (first) {
        this.nativeDocs = await this.session.invoke({
          server: "cua_repl",
          code: NATIVE_SETUP,
          title: "Computer control setup",
          relay,
          signal,
        });
        if (this.nativeDocs.isError === true) {
          return this.nativeDocs;
        }
        this.nativeReady = true;
      }
      if (first || code.trim().length === 0) {
        return {
          content: [
            ...(this.nativeDocs?.content ?? []),
            ...(code.trim().length === 0
              ? []
              : [
                  {
                    type: "text" as const,
                    text: "Setup complete. Code was not run. Submit it again.",
                  },
                ]),
          ],
        };
      }
      return this.session.invoke({ server: "cua_repl", code, title, relay, signal });
    }
    const first = !this.chromeReady;
    if (first) {
      this.chromeDocs = await this.session.invoke({
        server: "node_repl",
        code: CHROME_SETUP,
        title: "Chrome control setup",
        relay,
        signal,
      });
      if (this.chromeDocs.isError === true) {
        return this.chromeDocs;
      }
      this.chromeReady = true;
    }
    if (first || code.trim().length === 0) {
      return {
        content: [
          ...(this.chromeDocs?.content ?? []),
          ...(code.trim().length === 0
            ? []
            : [
                {
                  type: "text" as const,
                  text: "Setup complete. Code was not run. Submit it again.",
                },
              ]),
        ],
      };
    }
    return this.session.invoke({ server: "node_repl", code, title, relay, signal });
  }

  public async reset(): Promise<void> {
    await this.session.reset();
    this.nativeReady = false;
    this.chromeReady = false;
    this.nativeDocs = undefined;
    this.chromeDocs = undefined;
  }

  public async end(): Promise<void> {
    await this.session.close();
    this.session = new CodexControlsSession(this.options);
    this.nativeReady = false;
    this.chromeReady = false;
    this.nativeDocs = undefined;
    this.chromeDocs = undefined;
  }

  public async dispose(): Promise<void> {
    await this.session.close();
  }
}

export { CodexControlsBridge };
export type { ControlTool };
