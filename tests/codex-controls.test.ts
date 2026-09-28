/* oxlint-disable eslint/no-underscore-dangle -- _meta is a JSON-RPC wire field. */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, watch } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { ReadonlyDeep } from "type-fest";
import { CodexControlsBridge } from "../src/computer/codex-controls/bridge.ts";
import { CodexControlsSession } from "../src/computer/codex-controls/app-server.ts";

const fixture = fileURLToPath(new URL("fixtures/codex-app-server.ts", import.meta.url));
const configFixture = fileURLToPath(
  new URL("fixtures/codex-controls-config.toml", import.meta.url),
);
const scratch = path.join(tmpdir(), `codex-controls-test-${randomUUID()}`);
const log = path.join(scratch, "rpc.jsonl");
const options = {
  executable: fixture,
  environment: { ...Bun.env, FAKE_LOG: log, CODEX_SECRET: "must-not-pass" },
  timeoutMs: 250,
  configPath: configFixture,
};
const relay = async (): Promise<{ action: "cancel" }> => ({ action: "cancel" });
const APPROVAL_DELAY_MS = 400;
const READY_TIMEOUT_MS = 1000;
const TWO_SESSIONS = 2;
async function delayedRelay(): Promise<{ action: "accept"; content: Record<string, never> }> {
  await Bun.sleep(APPROVAL_DELAY_MS);
  return { action: "accept", content: {} };
}
async function assertRejected(task: Promise<unknown>, message: string): Promise<void> {
  try {
    await task;
    throw new Error("Expected a rejected controls call");
  } catch (error) {
    expect(error instanceof Error && error.message.includes(message)).toBe(true);
  }
}
const loggedSchema = z
  .object({
    method: z.string().optional(),
    params: z
      .object({
        tool: z.string().optional(),
        arguments: z.object({ code: z.string().optional() }).optional(),
        _meta: z.record(z.string(), z.string()).optional(),
      })
      .loose()
      .optional(),
    envKeys: z.array(z.string()),
    args: z.array(z.string()),
  })
  .loose();

beforeEach(async () => {
  await mkdir(scratch, { recursive: true });
  await Bun.write(log, "");
});
afterEach(async () => {
  await rm(log, { force: true });
});

async function readMessages(): Promise<z.infer<typeof loggedSchema>[]> {
  const raw = await readFile(log, "utf8");
  if (raw.trim().length === 0) {
    return [];
  }
  return raw
    .trim()
    .split("\n")
    .map((line) => loggedSchema.parse(JSON.parse(line) as unknown));
}
function assertScopedLaunch(messages: ReadonlyDeep<z.infer<typeof loggedSchema>[]>): void {
  expect(messages.every((item) => item.envKeys.length === 0)).toBe(true);
  expect(messages[0]?.args).toContain("mcp_servers.playwright.enabled=false");
  expect(messages[0]?.args).not.toContain("mcp_servers.node_repl.enabled=false");
}
async function waitForCode(code: string): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, READY_TIMEOUT_MS);
  try {
    for await (const _event of watch(log, { signal: controller.signal })) {
      const messages = await readMessages();
      if (messages.some((item) => item.params?.arguments?.code === code)) {
        return;
      }
    }
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

test("starts an owned session and keeps one operation ID until reset", async () => {
  const bridge = new CodexControlsBridge(options);
  try {
    const docs = await bridge.execute({
      tool: "computer",
      code: "first action",
      title: "First",
      relay,
    });
    expect(docs.content.some((item) => item.type === "text" && item.text.includes("not run"))).toBe(
      true,
    );
    await bridge.execute({ tool: "computer", code: "step one", title: "One", relay });
    await bridge.execute({ tool: "computer", code: "step two", title: "Two", relay });
    await bridge.reset();
    await bridge.execute({ tool: "computer", code: "", title: "Docs", relay });
    await bridge.execute({ tool: "computer", code: "step three", title: "Three", relay });
  } finally {
    await bridge.dispose();
  }
  const messages = await readMessages();
  expect(messages.some((item) => item.method === "turn/start")).toBe(false);
  assertScopedLaunch(messages);
  const calls = messages.filter(
    (item) =>
      item.params?.tool === "js" && item.params.arguments?.code?.startsWith("step") === true,
  );
  expect(calls.map((item) => item.params?.arguments?.code)).toEqual([
    "step one",
    "step two",
    "step three",
  ]);
  const ids = calls.map((item) =>
    z
      .object({ session_id: z.string(), turn_id: z.string() })
      .parse(JSON.parse(item.params?._meta?.["x-codex-turn-metadata"] ?? "{}") as unknown),
  );
  expect(ids[0]?.session_id).toBe("owned-thread");
  expect(ids[0]?.turn_id).toBe(ids[1]?.turn_id);
  expect(ids[2]?.turn_id).not.toBe(ids[0]?.turn_id);
  expect(messages.some((item) => item.params?.tool === "js_reset")).toBe(true);
});

test("relays approval to the caller and fails closed on denial", async () => {
  const session = new CodexControlsSession(options);
  try {
    const result = await session.invoke({
      server: "cua_repl",
      code: "needsApproval",
      title: "Approval",
      relay,
    });
    expect(result.content).toEqual([{ type: "text", text: "cancel" }]);
  } finally {
    await session.close();
  }
});

test("allows time for a real approval response", async () => {
  const session = new CodexControlsSession(options);
  try {
    const result = await session.invoke({
      server: "cua_repl",
      code: "needsApproval",
      title: "Approval",
      relay: delayedRelay,
    });
    expect(result.content).toEqual([{ type: "text", text: "accept" }]);
  } finally {
    await session.close();
  }
});

test("end releases one session and the next call starts a fresh one", async () => {
  const bridge = new CodexControlsBridge(options);
  try {
    await bridge.execute({ tool: "computer", code: "", title: "Docs", relay });
    await bridge.end();
    await bridge.execute({ tool: "computer", code: "", title: "Docs", relay });
  } finally {
    await bridge.dispose();
  }
  const messages = await readMessages();
  expect(messages.filter((item) => item.method === "initialize")).toHaveLength(TWO_SESSIONS);
});

test("closes an execution that exceeds its timeout", async () => {
  const session = new CodexControlsSession(options);
  try {
    await session.invoke({ server: "cua_repl", code: "hang", title: "Timeout", relay });
    throw new Error("Expected a timeout");
  } catch (error) {
    expect(error instanceof Error && error.message.includes("timed out")).toBe(true);
  }
  try {
    await session.invoke({ server: "cua_repl", code: "later", title: "Later", relay });
    throw new Error("Expected a closed session");
  } catch (error) {
    expect(error instanceof Error && error.message.includes("closed")).toBe(true);
  }
});

test("Stop aborts an active controls call and closes its owned process", async () => {
  const controller = new AbortController();
  const session = new CodexControlsSession(options);
  const ready = waitForCode("hang");
  const task = session.invoke({
    server: "cua_repl",
    code: "hang",
    title: "Stop",
    relay,
    signal: controller.signal,
  });
  await ready;
  controller.abort();
  await assertRejected(task, "cancelled");
  await assertRejected(
    session.invoke({ server: "cua_repl", code: "later", title: "Later", relay }),
    "",
  );
  const messages = await readMessages();
  expect(messages.some((item) => item.params?.arguments?.code === "later")).toBe(false);
});
