import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ModelHost } from "../src/app/models/host.ts";
import { startProcess } from "../src/app/models/process.ts";

const responseText = '{"result":"external endpoint"}';
test("forwards endpoint requests and leaves external services running", async () => {
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      expect(request.headers.get("authorization")).toBe("Bearer test-credential");
      expect(await request.text()).toBe('{"model":"remote-model"}');
      return new Response(responseText, { headers: { "content-type": "application/json" } });
    },
  });
  const host = new ModelHost({
    paths: { integrations: "/unused", data: "/unused", uv: "/unused" },
    preferences: {
      retention: "cold",
      decision: { source: "endpoint", url: server.url.href, model: "remote-model" },
      text: { source: "endpoint", url: server.url.href, model: "text-model" },
    },
  });
  try {
    const request = new Request("http://localhost/v1/systemone", {
      method: "POST",
      headers: { authorization: "Bearer test-credential" },
      body: '{"model":"remote-model"}',
    });
    const response = await host.forward(request, host.decision);
    expect(await response.text()).toBe(responseText);
    await host.close();
    const stillRunning = await fetch(server.url, {
      method: "POST",
      headers: { authorization: "Bearer test-credential" },
      body: '{"model":"remote-model"}',
    });
    expect(await stillRunning.text()).toBe(responseText);
  } finally {
    await host.close();
    await server.stop(true);
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
