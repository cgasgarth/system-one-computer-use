import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { ModelHost } from "../src/app/models/host.ts";
import { startProcess } from "../src/app/models/process.ts";

const response = { answers: { next_action: { choice: "A0", probabilities: { A0: 1, A1: 0 } } } };
const ORPHAN_TEST_TIMEOUT_MS = 12_000;
const CHILD_STARTUP_MS = 100;
test("forwards an explicit remote endpoint request and leaves that service running", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "system-one-host-"));
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      if (request.method === "GET") {
        return Response.json({ ready: true });
      }
      expect(request.headers.get("authorization")).toBeNull();
      const body = z.object({ model: z.string() }).parse(await request.json());
      expect(body.model).toBe("remote-model");
      return Response.json(response);
    },
  });
  const host = new ModelHost({
    paths: { integrations: "/unused", data: directory, uv: "/unused" },
    preferences: {
      retention: "cold",
      decision: { source: "endpoint", url: server.url.href, model: "remote-model" },
      text: { source: "endpoint", url: server.url.href, model: "text-model" },
    },
  });
  try {
    const result = await host.forward(
      {
        role: "decision",
        body: {
          model: "remote-model",
          state: "Ready",
          questions: {
            next_action: {
              criteria: { A0: "Ready", A1: "Not ready" },
              instructions: "Choose Ready",
              type: "choice",
            },
          },
        },
      },
      new AbortController().signal,
    );
    expect(result).toEqual(response);
    await host.close();
    const stillRunning = await fetch(server.url);
    expect(stillRunning.ok).toBe(true);
  } finally {
    await host.close();
    await server.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
});

test("stops an owned serving process", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "system-one-process-"));
  const child = await startProcess(
    [process.execPath, "-e", "setInterval(() => {}, 1000)"],
    Bun.env,
    { logPath: path.join(directory, "process.log") },
  );
  try {
    await child.stop();
    expect(await child.exited).not.toBe(0);
    await child.stop();
  } finally {
    await child.stop();
    await rm(directory, { recursive: true, force: true });
  }
});

test(
  "stops a child that remains after its detached wrapper exits",
  async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "system-one-orphan-"));
    const pidFile = path.join(directory, "pids.json");
    const script = `const { spawn } = require("node:child_process");
const { writeFileSync } = require("node:fs");
const child = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], { stdio: "ignore" });
writeFileSync(${JSON.stringify(pidFile)}, JSON.stringify({ group: process.pid, descendant: child.pid }));
process.exit(0);`;
    const child = await startProcess([process.execPath, "-e", script], Bun.env, {
      logPath: path.join(directory, "process.log"),
    });
    let groupPid = 0;
    try {
      expect(await child.exited).toBe(0);
      const pids = z
        .object({ group: z.number(), descendant: z.number() })
        .parse(JSON.parse(await readFile(pidFile, "utf8")));
      groupPid = pids.group;
      process.kill(pids.descendant, 0);
      await Bun.sleep(CHILD_STARTUP_MS);
      await child.stop();
      expect(() => process.kill(-pids.group, 0)).toThrow();
      await child.stop();
    } finally {
      await child.stop();
      if (groupPid > 0) {
        try {
          process.kill(-groupPid, "SIGKILL");
        } catch {
          /* The owned test group already exited. */
        }
      }
      await rm(directory, { recursive: true, force: true });
    }
  },
  ORPHAN_TEST_TIMEOUT_MS,
);
