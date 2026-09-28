/* oxlint-disable typescript/prefer-readonly-parameter-types -- The external controls method has a mutable signal. */
import { expect, test } from "bun:test";
import { z } from "zod";
import type { CodexControlsSession } from "../src/computer/codex-controls/app-server.ts";
import { ChromeWire } from "../src/computer/codex-chrome/wire.ts";

const CALL_COUNT = 3;

class FakeSession {
  public readonly codes: string[] = [];
  public closed = false;

  public async invoke(
    request: Parameters<CodexControlsSession["invoke"]>[0],
  ): ReturnType<CodexControlsSession["invoke"]> {
    this.codes.push(request.code);
    const payload = Buffer.from(JSON.stringify({ value: "ready" }), "utf8").toString("base64");
    const marker = /nodeRepl\.write\("(?<marker>S1DATA:[^"]+)"/u.exec(request.code)?.groups?.[
      "marker"
    ];
    return {
      content: [
        {
          type: "text",
          text: this.codes.length === 1 ? "Chrome documentation" : `${marker ?? ""}${payload}`,
        },
      ],
    };
  }

  public async close(): Promise<void> {
    this.closed = true;
  }
}

test("boots once and carries a persistent tab binding across structured calls", async () => {
  const session = new FakeSession();
  const wire = new ChromeWire({
    approval: async (): Promise<{ readonly action: "cancel" }> => ({ action: "cancel" }),
    session,
  });
  const schema = z.object({ value: z.literal("ready") });
  expect(
    await wire.read(
      "s1Tab = await s1Chrome.tabs.new(); return {value:'ready'};",
      schema,
      "Create tab",
    ),
  ).toEqual({ value: "ready" });
  expect(await wire.read("return {value:'ready'};", schema, "Read tab")).toEqual({
    value: "ready",
  });
  expect(session.codes).toHaveLength(CALL_COUNT);
  expect(session.codes[0]).toContain("var s1Tab;");
  expect(session.codes[1]).toContain("s1Tab = await s1Chrome.tabs.new()");
  expect(session.codes[2]).toContain("return {value:'ready'}");
  await wire.close();
  expect(session.closed).toBe(false);
});

test("reports one actionable field error for an invalid Chrome response", async () => {
  const session = new FakeSession();
  const wire = new ChromeWire({
    approval: async (): Promise<{ readonly action: "cancel" }> => ({ action: "cancel" }),
    session,
  });
  expect(
    wire.read("return {value:'ready'};", z.object({ tabId: z.string() }), "Read tab"),
  ).rejects.toThrow("invalid Read tab data at tabId");
});
