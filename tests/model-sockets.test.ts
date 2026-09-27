import { expect, test } from "bun:test";
import { once } from "node:events";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import {
  clearStaleSocket,
  localModelEndpoint,
  prepareSocketDirectory,
  socketPaths,
} from "../src/app/models/sockets.ts";
import { expectFailure } from "./fixtures.ts";
import { localEndpoint } from "../src/models/transport/endpoint.ts";

const PRIVATE_DIRECTORY = 0o700;
const MODE_DIVISOR = 0o1000;
const LONG_PATH_LENGTH = 120;

test("local model sockets stay in a private app-data directory", async () => {
  const data = await mkdtemp("/tmp/system-one-sockets-");
  try {
    const paths = socketPaths(data);
    await prepareSocketDirectory(paths);
    const directory = await stat(paths.directory);
    expect(directory.mode % MODE_DIVISOR).toBe(PRIVATE_DIRECTORY);
    expect(paths.ingress).toBe(path.join(data, "ipc", "model.sock"));
    expect(localModelEndpoint(paths.ingress, "decision")).toContain("role=decision");
    expect(localModelEndpoint(paths.ingress, "text")).toContain("role=text");
  } finally {
    await rm(data, { recursive: true, force: true });
  }
});

test("refuses a data path that cannot fit a Unix socket", () => {
  expect(() => socketPaths(path.join("/tmp", "x".repeat(LONG_PATH_LENGTH)))).toThrow(
    "too long for local model sockets",
  );
});

test("encodes reserved characters in an absolute socket path", () => {
  const socket = "/tmp/system-one#test?/model.sock";
  const endpoint = localModelEndpoint(socket, "decision");
  expect(localEndpoint(endpoint)).toEqual({ path: socket, role: "decision" });
});

test("refuses to remove an active model socket", async () => {
  const directory = await mkdtemp("/tmp/system-one-sockets-");
  const socket = path.join(directory, "model.sock");
  const listener = createServer();
  try {
    listener.listen(socket);
    await once(listener, "listening");
    await expectFailure(clearStaleSocket(socket), "Another model service");
    const active = await stat(socket);
    expect(active.isSocket()).toBe(true);
  } finally {
    listener.close();
    await once(listener, "close");
    await rm(directory, { recursive: true, force: true });
  }
});

test("removes only an owned stale socket after its listener has died", async () => {
  const directory = await mkdtemp("/tmp/system-one-sockets-");
  const socket = path.join(directory, "model.sock");
  const script = `require("node:net").createServer().listen(${JSON.stringify(socket)}, () => process.stdout.write("ready\\n"))`;
  const child = Bun.spawn([process.execPath, "-e", script], { stdout: "pipe", stderr: "pipe" });
  try {
    const reader = child.stdout.getReader();
    await reader.read();
    reader.releaseLock();
    child.kill("SIGKILL");
    await child.exited;
    const stale = await stat(socket);
    expect(stale.isSocket()).toBe(true);
    await clearStaleSocket(socket);
    expect(await Bun.file(socket).exists()).toBe(false);
  } finally {
    child.kill("SIGKILL");
    await rm(directory, { recursive: true, force: true });
  }
});
