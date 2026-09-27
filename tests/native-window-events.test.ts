import { expect, test } from "bun:test";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { waitForNativeWindow } from "../src/computer/native-access.ts";
import { expectFailure } from "./fixtures.ts";

const EXECUTABLE_MODE = 0o700;
const SILENT_WAIT_MS = 60_000;
const WATCH_TIMEOUT_MS = 50;
const AFTER_READY_CHECK = 2;
async function observer(
  events: readonly {
    readonly event: "ready" | "available" | "unavailable" | "error";
    readonly message?: string;
  }[],
  check: (binary: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), "system-one-window-event-"));
  const binary = path.join(root, "observer");
  await Bun.write(
    binary,
    `#!${process.execPath}\n${events.map((event) => `console.log(${JSON.stringify(JSON.stringify(event))});`).join("\n")}\n`,
  );
  await chmod(binary, EXECUTABLE_MODE);
  try {
    await check(binary);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
test("executes the tool when an app does not support window notifications", async () => {
  await observer([{ event: "unavailable" }], async (binary) => {
    let performed = false;
    await waitForNativeWindow({
      binary,
      application: "Example",
      mode: "available",
      async act() {
        performed = true;
      },
    });
    expect(performed).toBe(true);
  });
});
test("preserves a real permission error and does not execute the tool", async () => {
  await observer(
    [{ event: "error", message: "Accessibility permission is missing" }],
    async (binary) => {
      let performed = false;
      await expectFailure(
        waitForNativeWindow({
          binary,
          application: "Example",
          mode: "available",
          async act() {
            performed = true;
          },
        }),
        "Accessibility permission is missing",
      );
      expect(performed).toBe(false);
    },
  );
});
test("Stop during watcher readiness prevents the app launch", async () => {
  await observer([{ event: "unavailable" }], async (binary) => {
    const controller = new AbortController();
    let launches = 0;
    const waiting = waitForNativeWindow({
      binary,
      application: "Example",
      mode: "available",
      signal: controller.signal,
      async act() {
        launches += 1;
      },
    });
    controller.abort(new Error("Stopped before launch"));
    await expectFailure(waiting, "Stopped before launch");
    expect(launches).toBe(0);
  });
});
test("a ready watcher launches exactly once after its final event", async () => {
  await observer([{ event: "ready" }, { event: "available" }], async (binary) => {
    let launches = 0;
    await waitForNativeWindow({
      binary,
      application: "Example",
      mode: "available",
      async act() {
        launches += 1;
      },
    });
    expect(launches).toBe(1);
  });
});
test("Stop after the readiness result but before act prevents launch", async () => {
  await observer([{ event: "unavailable" }], async (binary) => {
    const controller = new AbortController();
    const check = controller.signal.throwIfAborted.bind(controller.signal);
    let checks = 0;
    Object.defineProperty(controller.signal, "throwIfAborted", {
      value: () => {
        checks += 1;
        if (checks === AFTER_READY_CHECK) {
          controller.abort(new Error("Stopped after readiness"));
        }
        check();
      },
    });
    let launches = 0;
    await expectFailure(
      waitForNativeWindow({
        binary,
        application: "Example",
        mode: "available",
        signal: controller.signal,
        async act() {
          launches += 1;
        },
      }),
      "Stopped after readiness",
    );
    expect(launches).toBe(0);
  });
});
test("a silent watcher times out and prevents the app launch", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "system-one-silent-window-"));
  const binary = path.join(root, "observer");
  await Bun.write(binary, `#!${process.execPath}\nawait Bun.sleep(${SILENT_WAIT_MS});\n`);
  await chmod(binary, EXECUTABLE_MODE);
  let launches = 0;
  try {
    await expectFailure(
      waitForNativeWindow({
        binary,
        application: "Example",
        mode: "available",
        timeoutMs: WATCH_TIMEOUT_MS,
        async act() {
          launches += 1;
        },
      }),
      "observer stopped",
    );
    expect(launches).toBe(0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
