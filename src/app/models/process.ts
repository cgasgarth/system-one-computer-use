import { spawn } from "node:child_process";
import { mkdir, open } from "node:fs/promises";
import path from "node:path";
import { finished } from "node:stream/promises";
import { Readiness } from "./readiness.ts";
import type { ReadinessOptions } from "./readiness.ts";

const PRIVATE_MODE = 0o600;
const STOP_GRACE_MS = 5000;
interface ModelProcess {
  readonly exited: Promise<number>;
  readonly waitUntilReady: () => Promise<void>;
  readonly stop: () => Promise<void>;
}
async function startProcess(
  args: readonly string[],
  environment: Readonly<NodeJS.ProcessEnv>,
  options: { readonly logPath: string; readonly readiness?: ReadinessOptions },
): Promise<ModelProcess> {
  const { logPath, readiness } = options;
  const [command, ...parameters] = args;
  if (command === undefined) {
    throw new Error("Missing model runtime command");
  }
  await mkdir(path.dirname(logPath), { recursive: true });
  const log = await open(logPath, "a", PRIVATE_MODE);
  const child = spawn(command, parameters, {
    detached: true,
    env: environment,
    stdio: ["ignore", log.fd, "pipe"],
  });
  if (child.stderr === null) {
    await log.close();
    throw new Error("Missing model stderr pipe");
  }
  const output = log.createWriteStream();
  child.stderr.pipe(output);
  const logged = finished(output);
  const ready = readiness === undefined ? undefined : new Readiness(child.stderr, readiness);
  const completion = Promise.withResolvers<number>();
  child.once("error", (error) => {
    ready?.finish(error.message);
    completion.reject(error);
  });
  child.once("close", (code) => {
    ready?.finish(`Model stopped before startup completed. See ${logPath}`);
    completion.resolve(code ?? 1);
  });
  const exited = (async (): Promise<number> => {
    const [code] = await Promise.all([completion.promise, logged]);
    return code;
  })();
  return {
    exited,
    async waitUntilReady() {
      const error = await ready?.result;
      if (error !== undefined) {
        throw new Error(error);
      }
    },
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) {
        return;
      }
      const group = -child.pid;
      const timer = setTimeout(() => {
        try {
          process.kill(group, "SIGKILL");
        } catch {
          /* The owned group already exited. */
        }
      }, STOP_GRACE_MS);
      try {
        process.kill(group, "SIGTERM");
        await exited;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
export { startProcess };
export type { ModelProcess };
