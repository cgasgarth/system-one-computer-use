#!/usr/bin/env bun
/* oxlint-disable unicorn/prefer-top-level-await -- Executable fixture avoids top-level await per repository rule. */
import { appendFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { z } from "zod";

const APPROVAL_ID = 100;
const ARGUMENT_OFFSET = 2;
const LOG = Bun.env["FAKE_LOG"];
const messageSchema = z
  .object({
    id: z.number().optional(),
    method: z.string().optional(),
    params: z
      .object({ arguments: z.object({ code: z.string().optional() }).optional() })
      .loose()
      .optional(),
    result: z.object({ action: z.string().optional() }).optional(),
  })
  .loose();
const state: { approvalCall?: number } = {};
function send(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}
async function main(): Promise<void> {
  for await (const line of createInterface({ input: process.stdin })) {
    const message = messageSchema.parse(JSON.parse(line) as unknown);
    if (LOG !== undefined) {
      const envKeys = Object.keys(Bun.env).filter((key) =>
        /CODEX|CUA|SKY|BROWSER|MCP|NODE_REPL/iu.test(key),
      );
      await appendFile(
        LOG,
        `${JSON.stringify({ ...message, envKeys, args: Bun.argv.slice(ARGUMENT_OFFSET) })}\n`,
      );
    }
    if (message.method === "initialize") {
      send({ id: message.id, result: { protocolVersion: "2025-11-25" } });
    } else if (message.method === "thread/start") {
      send({ id: message.id, result: { thread: { id: "owned-thread" } } });
    } else if (message.method === "mcpServer/tool/call") {
      const code = message.params?.arguments?.code;
      if (code === "needsApproval" && message.id !== undefined) {
        state.approvalCall = message.id;
        send({
          id: APPROVAL_ID,
          method: "mcpServer/elicitation/request",
          params: {
            threadId: "owned-thread",
            mode: "form",
            message: "Allow Computer Use?",
            requestedSchema: { type: "object", properties: {} },
            _meta: { codex_approval_kind: "mcp_tool_call" },
          },
        });
      } else if (code !== "hang") {
        send({ id: message.id, result: { content: [{ type: "text", text: code ?? "hook" }] } });
      }
    } else if (message.id === APPROVAL_ID && state.approvalCall !== undefined) {
      send({
        id: state.approvalCall,
        result: { content: [{ type: "text", text: message.result?.action ?? "missing" }] },
      });
      delete state.approvalCall;
    } else if (message.id !== undefined) {
      send({ id: message.id, result: {} });
    }
  }
}
void main();
