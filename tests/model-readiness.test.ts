import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import type { ReadonlyDeep } from "type-fest";
import os from "node:os";
import path from "node:path";
import { startProcess } from "../src/app/models/process.ts";
import type { ModelProcess } from "../src/app/models/process.ts";

const TIMEOUT_MS = 2000;
const SHORT_TIMEOUT_MS = 30;
const READY = "Server listening";
type RunCheck = (child: Readonly<ModelProcess>, log: string) => Promise<void>;
async function withProcess(
  script: string,
  check: RunCheck,
  options: { readonly signal?: ReadonlyDeep<AbortSignal>; readonly timeoutMs?: number } = {},
): Promise<void> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "system-one-ready-"));
  const logPath = path.join(directory, "server.log");
  const child = await startProcess([process.execPath, "-e", script], Bun.env, {
    logPath,
    readiness: {
      message: READY,
      signal: options.signal ?? new AbortController().signal,
      timeoutMs: options.timeoutMs ?? TIMEOUT_MS,
    },
  });
  try {
    await check(child, logPath);
  } finally {
    await child.stop();
    await rm(directory, { recursive: true, force: true });
  }
}

async function expectReadyError(child: Readonly<ModelProcess>, message: string): Promise<void> {
  let failure = "";
  try {
    await child.waitUntilReady();
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }
  expect(failure).toContain(message);
}

test("recognizes split startup output and keeps draining logs after readiness", async () => {
  await withProcess(
    String.raw`process.stderr.write("Loading\nServer "); await Bun.sleep(10); process.stderr.write("listening\n"); await Bun.sleep(10); process.stderr.write("after ready\n");`,
    async (child, log) => {
      await child.waitUntilReady();
      expect(await child.exited).toBe(0);
      expect(await readFile(log, "utf8")).toBe("Loading\nServer listening\nafter ready\n");
    },
  );
});

test("reports process exit before readiness", async () => {
  await withProcess(
    String.raw`process.stderr.write("Load failed\n"); process.exit(1);`,
    async (child) => {
      await expectReadyError(child, "stopped before startup");
      expect(await child.exited).toBe(1);
    },
  );
});

test("cancels a pending startup event wait and stops its process", async () => {
  const controller = new AbortController();
  await withProcess(
    "setInterval(() => {}, 1000)",
    async (child) => {
      controller.abort();
      await expectReadyError(child, "cancelled");
      await child.stop();
      expect(await child.exited).not.toBe(0);
    },
    { signal: controller.signal },
  );
});

test("times out a server that never emits readiness", async () => {
  await withProcess(
    "setInterval(() => {}, 1000)",
    async (child) => {
      await expectReadyError(child, "timed out");
    },
    { timeoutMs: SHORT_TIMEOUT_MS },
  );
});

test("retains cancellation that happened before the process attached", async () => {
  const controller = new AbortController();
  controller.abort();
  await withProcess(
    String.raw`process.stderr.write("Server listening\n");`,
    async (child) => {
      await expectReadyError(child, "cancelled");
    },
    { signal: controller.signal },
  );
});
