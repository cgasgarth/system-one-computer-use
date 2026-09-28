/* oxlint-disable unicorn/prefer-add-event-listener -- The SDK transport exposes onclose, not EventTarget. */
import { McpServer } from "@modelcontextprotocol/server";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import { CodexControlsBridge } from "../computer/codex-controls/bridge.ts";

const MAX_TITLE_LENGTH = 120;
const surfaceFlag = Bun.argv.indexOf("--surface");
const surface = surfaceFlag === -1 ? "both" : Bun.argv[surfaceFlag + 1];
if (surface !== "both" && surface !== "computer" && surface !== "chrome") {
  throw new Error("Use --surface computer or --surface chrome");
}
const bridge = new CodexControlsBridge();
const server = new McpServer({ name: `system-one-${surface}-controls`, version: "0.1.0" });
const inputSchema = z.object({
  code: z.string().default(""),
  title: z.string().min(1).max(MAX_TITLE_LENGTH).default("External computer control"),
});

function failure(error: unknown): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: error instanceof Error ? error.message : "Controls failed" }],
  };
}

if (surface === "both" || surface === "computer") {
  server.registerTool(
    "computer_js",
    {
      title: "Computer controls",
      description:
        "Run persistent computer-use JavaScript. The first call returns the API and screen state; resubmit code after setup. Tool access is approved automatically.",
      inputSchema,
    },
    async ({ code, title }, ctx) => {
      try {
        return await bridge.execute({
          tool: "computer",
          code,
          title,
          signal: ctx.mcpReq.signal,
        });
      } catch (error) {
        return failure(error);
      }
    },
  );
}
if (surface === "both" || surface === "chrome") {
  server.registerTool(
    "chrome_js",
    {
      title: "Chrome controls",
      description:
        "Run persistent Chrome JavaScript. The first call defines chrome and returns its API; resubmit code after setup. Close tabs you create before ending the session.",
      inputSchema,
    },
    async ({ code, title }, ctx) => {
      try {
        return await bridge.execute({
          tool: "chrome",
          code,
          title,
          signal: ctx.mcpReq.signal,
        });
      } catch (error) {
        return failure(error);
      }
    },
  );
}
server.registerTool(
  "reset_controls",
  { description: "End the current operation group and clear persistent REPL state." },
  async () => {
    try {
      await bridge.reset();
      return { content: [{ type: "text", text: "Controls reset." }] };
    } catch (error) {
      return failure(error);
    }
  },
);
server.registerTool(
  "end_controls",
  { description: "End the owned Codex controls session." },
  async () => {
    try {
      await bridge.end();
      return { content: [{ type: "text", text: "Controls session ended." }] };
    } catch (error) {
      return failure(error);
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
server.server.onclose = (): void => {
  void bridge.dispose();
};
