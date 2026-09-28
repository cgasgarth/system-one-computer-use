import { CallToolResultSchema } from "@modelcontextprotocol/core";
import { z } from "zod";

const rpcMessageSchema = z.union([
  z.object({ id: z.union([z.number(), z.string()]), method: z.string(), params: z.unknown() }),
  z.object({ id: z.union([z.number(), z.string()]), result: z.unknown() }),
  z.object({
    id: z.union([z.number(), z.string()]),
    error: z.object({ code: z.number(), message: z.string() }),
  }),
  z.object({ method: z.string(), params: z.unknown() }),
]);
type RpcMessage = z.infer<typeof rpcMessageSchema>;

const startedSchema = z.object({ thread: z.object({ id: z.string().min(1) }) });
const toolResultSchema = CallToolResultSchema;
const approvalRequestSchema = z.object({
  threadId: z.string(),
  mode: z.literal("form"),
  message: z.string(),
  requestedSchema: z.object({ type: z.literal("object") }).loose(),
  _meta: z.object({ codex_approval_kind: z.literal("mcp_tool_call") }).loose(),
});
interface CodexComputerOptions {
  readonly signal?: AbortSignal;
}

export { approvalRequestSchema, rpcMessageSchema, startedSchema, toolResultSchema };
export type { CodexComputerOptions, RpcMessage };
