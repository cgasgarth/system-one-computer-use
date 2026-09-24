import { spawn } from "node:child_process";
import { mkdir, open } from "node:fs/promises";
import path from "node:path";

const PRIVATE_MODE = 0o600;
const STOP_GRACE_MS = 5000;
interface ModelProcess {
  readonly exited: Promise<number>;
  readonly stop: () => Promise<void>;
}
async function startProcess(
  args: readonly string[],
  environment: Readonly<NodeJS.ProcessEnv>,
  logPath: string,
): Promise<ModelProcess> {
  const [command, ...parameters] = args;
  if (command === undefined) {
    throw new Error("Missing model runtime command");
  }
  await mkdir(path.dirname(logPath), { recursive: true });
  const log = await open(logPath, "a", PRIVATE_MODE);
  const child = spawn(command, parameters, {
    detached: true,
    env: environment,
    stdio: ["ignore", log.fd, log.fd],
  });
  const completion = Promise.withResolvers<number>();
  child.once("error", completion.reject);
  child.once("exit", (code) => {
    completion.resolve(code ?? 1);
  });
  const exited = completion.promise;
  await log.close();
  return {
    exited,
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
