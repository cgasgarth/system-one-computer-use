import { spawn } from "node:child_process";
import { mkdir, open } from "node:fs/promises";
import path from "node:path";
import { finished } from "node:stream/promises";
import { z } from "zod";
import { Readiness } from "./readiness.ts";
import type { ReadinessOptions } from "./readiness.ts";

const PRIVATE_MODE = 0o600;
const STOP_GRACE_MS = 5000;
const STOP_REAP_MS = 1000;
const missingProcess = z.object({ code: z.literal("ESRCH") });
function groupExists(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    if (missingProcess.safeParse(error).success) {
      return false;
    }
    throw error;
  }
}
function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (!missingProcess.safeParse(error).success) {
      throw error;
    }
  }
}
async function waitForGroupExit(pid: number, exited: Promise<number>): Promise<void> {
  await Promise.race([
    Bun.sleep(STOP_GRACE_MS),
    exited.then(
      async () => {
        if (groupExists(pid)) {
          await Bun.sleep(STOP_GRACE_MS);
        }
        return 0;
      },
      async () => {
        await Bun.sleep(STOP_GRACE_MS);
        return 0;
      },
    ),
  ]);
}
async function stopGroup(pid: number, exited: Promise<number>): Promise<void> {
  if (!groupExists(pid)) {
    return;
  }
  signalGroup(pid, "SIGTERM");
  await waitForGroupExit(pid, exited);
  if (!groupExists(pid)) {
    return;
  }
  signalGroup(pid, "SIGKILL");
  await Promise.race([exited.catch(() => 1), Bun.sleep(STOP_REAP_MS)]);
}
interface ModelProcess {
  readonly exited: Promise<number>;
  readonly waitUntilReady: () => Promise<void>;
  readonly stop: () => Promise<void>;
}
// Process startup binds the child, log stream, readiness marker, and owned group.
// oxlint-disable-next-line max-statements
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
  const groupPid = child.pid;
  let stopping: Promise<void> | undefined = undefined;
  return {
    exited,
    async waitUntilReady() {
      const error = await ready?.result;
      if (error !== undefined) {
        throw new Error(error);
      }
    },
    async stop() {
      if (groupPid === undefined) {
        return;
      }
      stopping ??= stopGroup(groupPid, exited);
      await stopping;
    },
  };
}
export { startProcess };
export type { ModelProcess };
