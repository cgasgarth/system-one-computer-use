import { chmod, lstat, mkdir, rm } from "node:fs/promises";
import type { Stats } from "node:fs";
import { createConnection } from "node:net";
import path from "node:path";
import { z } from "zod";

const MAX_UNIX_PATH_BYTES = 103;
const PRIVATE_DIRECTORY = 0o700;
const PROBE_TIMEOUT_MS = 1000;
const errorSchema = z.object({ code: z.string() });
interface SocketPaths {
  readonly directory: string;
  readonly ingress: string;
  readonly decision: string;
  readonly text: string;
}
function socketPaths(data: string): SocketPaths {
  const directory = path.join(data, "ipc");
  if (Buffer.byteLength(path.join(directory, "decision.sock")) > MAX_UNIX_PATH_BYTES) {
    throw new Error(
      "The application data path is too long for local model sockets. Move the app data directory to a shorter path.",
    );
  }
  return {
    directory,
    ingress: path.join(directory, "model.sock"),
    decision: path.join(directory, "decision.sock"),
    text: path.join(directory, "text.sock"),
  };
}
async function prepareSocketDirectory(paths: SocketPaths): Promise<void> {
  await mkdir(paths.directory, { recursive: true, mode: PRIVATE_DIRECTORY });
  const state = await lstat(paths.directory);
  if (!state.isDirectory() || state.isSymbolicLink() || state.uid !== process.getuid?.()) {
    throw new Error("The model socket directory is not owned by this user.");
  }
  await chmod(paths.directory, PRIVATE_DIRECTORY);
}
async function existingSocket(file: string): Promise<Stats | undefined> {
  try {
    return await lstat(file);
  } catch (error) {
    if (errorSchema.safeParse(error).data?.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}
async function socketState(file: string): Promise<"active" | "stale"> {
  const result = Promise.withResolvers<"active" | "stale">();
  const socket = createConnection({ path: file });
  socket.once("connect", () => {
    result.resolve("active");
  });
  socket.once("error", (error) => {
    if (errorSchema.safeParse(error).data?.code === "ECONNREFUSED") {
      result.resolve("stale");
    } else {
      result.reject(error);
    }
  });
  socket.setTimeout(PROBE_TIMEOUT_MS, () => {
    result.reject(new Error("Model socket probe timed out."));
  });
  try {
    return await result.promise;
  } finally {
    socket.destroy();
  }
}
async function clearStaleSocket(file: string): Promise<void> {
  const existing = await existingSocket(file);
  if (existing === undefined) {
    return;
  }
  if (!existing.isSocket() || existing.isSymbolicLink() || existing.uid !== process.getuid?.()) {
    throw new Error("The model socket path is not an owned Unix socket.");
  }
  if ((await socketState(file)) === "active") {
    throw new Error(
      "Another model service is using the local socket. Stop it before loading a second model.",
    );
  }
  await rm(file, { force: true });
}
function localModelEndpoint(socket: string, role: "decision" | "text"): string {
  const url = new URL("unix:///");
  url.pathname = socket;
  url.searchParams.set("role", role);
  return url.toString();
}

export { clearStaleSocket, localModelEndpoint, prepareSocketDirectory, socketPaths };
export type { SocketPaths };
