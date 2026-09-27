import { expect, test } from "bun:test";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import type { Socket } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ReadonlyDeep } from "type-fest";
import { z } from "zod";
import { requestJson } from "../src/models/request.ts";
import { endpointSchema } from "../src/models/transport/endpoint.ts";

const REQUEST_TIMEOUT_MS = 2000;
const FRAGMENT_DELAY_MS = 5;
const responseSchema = z.strictObject({ value: z.string() });
interface LocalFixture {
  readonly endpoint: string;
  readonly close: () => Promise<void>;
}

async function fixture(connected: (socket: ReadonlyDeep<Socket>) => void): Promise<LocalFixture> {
  const directory = await mkdtemp(path.join(tmpdir(), "s1-"));
  const socketPath = path.join(directory, "m.sock");
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => {
      sockets.delete(socket);
    });
    connected(socket);
  });
  const ready = once(server, "listening");
  server.listen(socketPath);
  await ready;
  const url = new URL(`unix://${socketPath}`);
  url.searchParams.set("role", "decision");
  return {
    endpoint: url.href,
    async close() {
      for (const socket of sockets) {
        socket.destroy();
      }
      const closed = once(server, "close");
      server.close();
      await closed;
      await rm(directory, { recursive: true });
    },
  };
}

async function failureMessage(operation: Promise<object>): Promise<string> {
  try {
    await operation;
    return "";
  } catch (error) {
    return error instanceof Error ? error.message : "Unknown failure";
  }
}

test("local inference reads a split JSON response over a Unix socket", async () => {
  let receivedRole = "";
  const local = await fixture((socket) => {
    socket.once("data", (data: Readonly<Buffer>) => {
      const request = z
        .object({ role: z.literal("decision"), body: z.object({ input: z.string() }) })
        .parse(JSON.parse(data.toString("utf8")));
      receivedRole = request.role;
      socket.write('{"ok":true,"body":{"value":');
      setTimeout(() => {
        socket.end('"ready"}}\n');
      }, FRAGMENT_DELAY_MS);
    });
  });
  try {
    const result = await requestJson({
      endpoint: local.endpoint,
      body: { input: "test" },
      apiKey: undefined,
      label: "Test",
      schema: responseSchema,
      timeoutMs: REQUEST_TIMEOUT_MS,
    });
    expect(result.value).toBe("ready");
    expect(receivedRole).toBe("decision");
  } finally {
    await local.close();
  }
});

test("local inference validates result data at the process boundary", async () => {
  const local = await fixture((socket) => {
    socket.once("data", () => {
      socket.end('{"ok":true,"body":{"value":123}}\n');
    });
  });
  try {
    const message = await failureMessage(
      requestJson({
        endpoint: local.endpoint,
        body: {},
        apiKey: undefined,
        label: "Test",
        schema: responseSchema,
        timeoutMs: REQUEST_TIMEOUT_MS,
      }),
    );
    expect(message.length).toBeGreaterThan(0);
  } finally {
    await local.close();
  }
});

test("Stop closes a pending local inference connection", async () => {
  const controller = new AbortController();
  const disconnected = Promise.withResolvers<boolean>();
  const local = await fixture((socket) => {
    socket.once("close", () => {
      disconnected.resolve(true);
    });
    socket.once("data", () => {
      controller.abort(new Error("Stopped by user"));
    });
  });
  try {
    const message = await failureMessage(
      requestJson({
        endpoint: local.endpoint,
        body: {},
        apiKey: undefined,
        label: "Test",
        schema: responseSchema,
        timeoutMs: REQUEST_TIMEOUT_MS,
        signal: controller.signal,
      }),
    );
    expect(message).toBe("Stopped by user");
    await disconnected.promise;
  } finally {
    await local.close();
  }
});

test("Unix endpoint configuration requires a local path and model role", () => {
  expect(endpointSchema.safeParse("unix:///tmp/model.sock?role=text").success).toBe(true);
  expect(endpointSchema.safeParse("unix://other-host/tmp/model.sock?role=text").success).toBe(
    false,
  );
  expect(endpointSchema.safeParse("unix:///tmp/model.sock").success).toBe(false);
});
