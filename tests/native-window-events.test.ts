import { expect, test } from "bun:test";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { waitForNativeWindow } from "../src/computer/native-access.ts";
import { expectFailure } from "./fixtures.ts";

const EXECUTABLE_MODE = 0o700;
async function observer(
  event: { readonly event: "unavailable" | "error"; readonly message?: string },
  check: (binary: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), "system-one-window-event-"));
  const binary = path.join(root, "observer");
  await Bun.write(
    binary,
    `#!${process.execPath}\nconsole.log(${JSON.stringify(JSON.stringify(event))});\n`,
  );
  await chmod(binary, EXECUTABLE_MODE);
  try {
    await check(binary);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
test("executes the tool when an app does not support window notifications", async () => {
  await observer({ event: "unavailable" }, async (binary) => {
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
    { event: "error", message: "Accessibility permission is missing" },
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
