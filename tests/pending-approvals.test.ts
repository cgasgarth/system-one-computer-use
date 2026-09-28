import { expect, test } from "bun:test";
import { approvalRequestSchema } from "../src/computer/codex-controls/protocol.ts";
import type { ApprovalRequest } from "../src/computer/codex-controls/protocol.ts";
import { PendingApprovals } from "../src/app/pending-approvals.ts";
import type { ApprovalEvent } from "../src/app/approval-protocol.ts";

const expectedEvents = 2;
const afterCancelIndex = 2;
function eventId(events: readonly ApprovalEvent[], index: number): string {
  const id = events[index]?.requestId;
  if (id === undefined) {
    throw new Error("The approval prompt was not emitted.");
  }
  return id;
}
function request(required: readonly string[] = []): ApprovalRequest {
  return approvalRequestSchema.parse({
    threadId: "test-thread",
    mode: "form",
    message: "Allow Calculator access?",
    requestedSchema: { type: "object", required },
    _meta: {
      codex_approval_kind: "mcp_tool_call",
      connector_id: "computer-use",
      tool_name: "get_app_state",
      tool_params: { app: "com.apple.calculator" },
    },
  });
}
function appRequest(app: string, riskLevel = "low"): ApprovalRequest {
  return approvalRequestSchema.parse({
    threadId: "test-thread",
    mode: "form",
    message: `Allow ${app}?`,
    requestedSchema: { type: "object", properties: {} },
    _meta: {
      codex_approval_kind: "mcp_tool_call",
      connector_id: "computer-use",
      persist: ["session", "always"],
      riskLevel,
      tool_name: "get_app_state",
      tool_params: { app },
    },
  });
}

test("holds an exact request for a human Allow or Decline choice", async () => {
  const events: ApprovalEvent[] = [];
  const approvals = new PendingApprovals((event) => {
    events.push(event);
  });
  const signal = new AbortController();
  const allowed = approvals.request(request(), signal.signal);
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ app: "com.apple.calculator", tool: "get_app_state" });
  expect(
    approvals.respond({
      kind: "approval_response",
      requestId: eventId(events, 0),
      decision: "allow_once",
    }),
  ).toBe(true);
  expect(await allowed).toEqual({ action: "accept", content: {} });

  const declined = approvals.request(request(), signal.signal);
  expect(
    approvals.respond({
      kind: "approval_response",
      requestId: crypto.randomUUID(),
      decision: "allow_once",
    }),
  ).toBe(false);
  expect(
    approvals.respond({
      kind: "approval_response",
      requestId: eventId(events, 1),
      decision: "decline",
    }),
  ).toBe(true);
  expect(await declined).toEqual({ action: "decline" });
});

test("Stop and closed input cancel pending requests; required form data cannot be auto-filled", async () => {
  const events: ApprovalEvent[] = [];
  const approvals = new PendingApprovals((event) => {
    events.push(event);
  });
  const signal = new AbortController();
  const pending = approvals.request(request(), signal.signal);
  signal.abort();
  expect(await pending).toEqual({ action: "cancel" });
  expect(
    approvals.respond({
      kind: "approval_response",
      requestId: eventId(events, 0),
      decision: "allow_once",
    }),
  ).toBe(false);

  const another = approvals.request(request(), new AbortController().signal);
  approvals.cancelAll();
  expect(await another).toEqual({ action: "cancel" });
  expect(
    await approvals.request(request(["extraApprovalField"]), new AbortController().signal),
  ).toEqual({ action: "cancel" });
  expect(events).toHaveLength(expectedEvents);
});

test("task grant is limited to the exact app", async () => {
  const events: ApprovalEvent[] = [];
  const approvals = new PendingApprovals((event) => {
    events.push(event);
  });
  const signal = new AbortController();
  const first = approvals.request(appRequest("com.apple.calculator"), signal.signal);
  expect(events[0]?.canAllowTask).toBe(true);
  approvals.respond({
    kind: "approval_response",
    requestId: eventId(events, 0),
    decision: "allow_task",
  });
  expect(await first).toEqual({ action: "accept", content: {} });
  expect(await approvals.request(appRequest("com.apple.calculator"), signal.signal)).toEqual({
    action: "accept",
    content: {},
  });
  expect(events).toHaveLength(1);

  const other = approvals.request(appRequest("com.apple.TextEdit"), signal.signal);
  expect(events[1]?.app).toBe("com.apple.TextEdit");
  approvals.respond({
    kind: "approval_response",
    requestId: eventId(events, 1),
    decision: "decline",
  });
  expect(await other).toEqual({ action: "decline" });
});

test("risky actions cannot obtain a task grant and Stop clears a prior grant", async () => {
  const events: ApprovalEvent[] = [];
  const approvals = new PendingApprovals((event) => {
    events.push(event);
  });
  const signal = new AbortController();
  const first = approvals.request(appRequest("com.apple.calculator"), signal.signal);
  approvals.respond({
    kind: "approval_response",
    requestId: eventId(events, 0),
    decision: "allow_task",
  });
  await first;
  const risky = approvals.request(appRequest("com.apple.calculator", "high"), signal.signal);
  expect(events[1]?.canAllowTask).toBe(false);
  approvals.respond({
    kind: "approval_response",
    requestId: eventId(events, 1),
    decision: "allow_task",
  });
  expect(await risky).toEqual({ action: "decline" });

  approvals.cancelAll();
  const again = approvals.request(appRequest("com.apple.calculator"), signal.signal);
  expect(events[afterCancelIndex]?.canAllowTask).toBe(true);
  approvals.respond({
    kind: "approval_response",
    requestId: eventId(events, afterCancelIndex),
    decision: "decline",
  });
  expect(await again).toEqual({ action: "decline" });
});
