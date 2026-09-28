import { createInterface } from "node:readline";
import { approvalRequestSchema } from "../../src/computer/codex-controls/protocol.ts";
import { PendingApprovals } from "../../src/app/pending-approvals.ts";
import { consumeWorkerInput } from "../../src/app/worker-input.ts";

const stopped = new AbortController();
const write = (value: object): void => {
  process.stdout.write(`${JSON.stringify(value)}\n`);
};
const approvals = new PendingApprovals(write);
const request = approvalRequestSchema.parse({
  threadId: "fixture-thread",
  mode: "form",
  message: "Allow Calculator access?",
  requestedSchema: { type: "object", properties: {} },
  _meta: {
    codex_approval_kind: "mcp_tool_call",
    connector_id: "computer-use",
    riskLevel: "low",
    persist: ["session"],
    tool_name: "get_app_state",
    tool_params: { app: "com.apple.calculator" },
  },
});

async function main(): Promise<void> {
  await consumeWorkerInput(createInterface({ input: process.stdin }), {
    async run() {
      const first = await approvals.request(request, stopped.signal);
      const second = await approvals.request(request, stopped.signal);
      write({ status: "resolved", actions: [first.action, second.action] });
    },
    respond(response) {
      write({ status: "reply", matched: approvals.respond(response) });
    },
    cancel() {
      approvals.cancelAll();
      stopped.abort();
    },
    busy() {
      throw new Error("Unexpected second task.");
    },
    error(error) {
      throw error;
    },
    stopped: () => stopped.signal.aborted,
  });
}
// eslint-disable-next-line node/no-top-level-await -- This is a standalone subprocess fixture.
await main();
