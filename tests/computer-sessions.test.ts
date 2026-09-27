import { expect, test } from "bun:test";
import { ComputerSessions } from "../src/app/computers.ts";
import type { ComputerMode, ManagedComputer } from "../src/computer/types.ts";
import { computerFixture } from "./fixtures.ts";

function fixture(onClose: () => Promise<void>): ManagedComputer {
  return { ...computerFixture().computer, close: onClose };
}

test("reuses browser tools and releases only the desktop task connection", async () => {
  const created: ComputerMode[] = [];
  const closed: ComputerMode[] = [];
  const sessions = new ComputerSessions((mode) => {
    created.push(mode);
    return fixture(async () => {
      closed.push(mode);
    });
  });
  const browser = sessions.get("browser");
  expect(sessions.get("browser")).toBe(browser);
  const firstDesktop = sessions.get("desktop");
  await sessions.closeDesktop();
  expect(closed).toEqual(["desktop"]);
  expect(sessions.get("browser")).toBe(browser);
  expect(sessions.get("desktop")).not.toBe(firstDesktop);
  await sessions.close();
  expect(created).toEqual(["browser", "desktop", "desktop"]);
  expect(closed.toSorted()).toEqual(["browser", "desktop", "desktop"]);
});

test("terminal close waits for desktop teardown and closes each driver once", async () => {
  const desktopGate = Promise.withResolvers<boolean>();
  let desktopCloses = 0;
  let browserCloses = 0;
  const sessions = new ComputerSessions((mode) =>
    fixture(async () => {
      if (mode === "desktop") {
        desktopCloses += 1;
        await desktopGate.promise;
      } else {
        browserCloses += 1;
      }
    }),
  );
  sessions.get("desktop");
  sessions.get("browser");
  const desktopClosing = sessions.closeDesktop();
  expect(() => sessions.get("desktop")).toThrow("still closing");
  const firstClose = sessions.close();
  expect(sessions.close()).toBe(firstClose);
  let finished = false;
  const observed = (async (): Promise<void> => {
    await firstClose;
    finished = true;
  })();
  await Promise.resolve();
  expect(finished).toBe(false);
  expect(() => sessions.get("browser")).toThrow("closed");
  desktopGate.resolve(true);
  await Promise.all([desktopClosing, firstClose, sessions.closeDesktop(), observed]);
  expect(desktopCloses).toBe(1);
  expect(browserCloses).toBe(1);
  expect(finished).toBe(true);
});

test("closing unused sessions prevents later driver creation", async () => {
  let created = 0;
  const sessions = new ComputerSessions(() => {
    created += 1;
    return fixture(async () => {
      /* No driver was created in this test. */
    });
  });
  await sessions.close();
  await sessions.close();
  expect(created).toBe(0);
  expect(() => sessions.get("desktop")).toThrow("closed");
});
