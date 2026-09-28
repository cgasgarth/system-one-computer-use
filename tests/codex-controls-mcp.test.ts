import { expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

test("stdio MCP exposes only the selected surface", async () => {
  const client = new Client({ name: "codex-controls-test", version: "0.1.0" });
  const transport = new StdioClientTransport({
    command: Bun.which("bun") ?? "bun",
    args: ["src/app/codex-controls-mcp.ts", "--surface", "computer"],
  });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name)).toEqual([
      "computer_js",
      "reset_controls",
      "end_controls",
    ]);
  } finally {
    await client.close();
  }
});
