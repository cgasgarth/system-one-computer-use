import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const PRIVATE_EXEC_MODE = 0o700;
const MAX_PROBE_MS = 5000;
const TEST_TIMEOUT_MS = 10_000;
let directory = "";
let entry = "";

beforeAll(async () => {
  directory = await mkdtemp(path.resolve("runs/permission-probe-"));
  const build = await Bun.build({
    entrypoints: ["src/app/permission-status.ts"],
    outdir: directory,
    target: "bun",
  });
  expect(build.success).toBe(true);
  entry = path.join(directory, "permission-status.js");
});

afterAll(async () => {
  if (directory) {
    await rm(directory, { recursive: true, force: true });
  }
});

async function status(script: string): Promise<{ exit: number; stdout: string }> {
  const driver = path.join(directory, `driver-${crypto.randomUUID()}.sh`);
  await writeFile(driver, `#!/bin/sh\n${script}\n`);
  await chmod(driver, PRIVATE_EXEC_MODE);
  const child = Bun.spawn([process.execPath, entry], {
    cwd: directory,
    stdout: "pipe",
    stderr: "ignore",
    env: {
      ...Bun.env,
      CUA_DRIVER_BIN: driver,
      SYSTEM_ONE_MODEL: "test",
      SYSTEM_ONE_URL: "http://127.0.0.1:8700",
      TEXT_MODEL_ID: "test",
      TEXT_MODEL_URL: "http://127.0.0.1:8080",
    },
  });
  const [exit, stdout] = await Promise.all([child.exited, new Response(child.stdout).text()]);
  return { exit, stdout };
}

test("the configured driver status is accepted only with daemon attribution", async () => {
  const correct = await status(
    `printf '%s\\n' '{"accessibility":true,"screen_recording":false,"source":{"attribution":"driver-daemon","bundle_id":"com.trycua.driver"}}'`,
  );
  expect(correct.exit).toBe(0);
  expect(JSON.parse(correct.stdout)).toEqual({
    accessibility: true,
    screen_recording: false,
    source: { attribution: "driver-daemon", bundle_id: "com.trycua.driver" },
  });
  const wrongOwner = await status(
    `printf '%s\\n' '{"accessibility":true,"screen_recording":true,"source":{"attribution":"caller","bundle_id":"com.example.app"}}'`,
  );
  expect(wrongOwner.exit).not.toBe(0);
});

test(
  "malformed and timed-out driver reports fail closed",
  async () => {
    const malformed = await status(String.raw`printf '%s\n' 'not-json'`);
    expect(malformed.exit).not.toBe(0);
    const started = Date.now();
    const timedOut = await status("exec sleep 10");
    expect(timedOut.exit).not.toBe(0);
    expect(Date.now() - started).toBeLessThan(MAX_PROBE_MS);
  },
  TEST_TIMEOUT_MS,
);
