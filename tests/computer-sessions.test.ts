import { expect, test } from "bun:test";
import { ComputerSessions } from "../src/app/computers.ts";
import type { ComputerMode, ManagedComputer } from "../src/computer/types.ts";
import { computerFixture } from "./fixtures.ts";

const SURFACE_COUNT = 2;
const TWO_TASKS = 2;

function fixture(onClose: () => Promise<void>): ManagedComputer {
  return { ...computerFixture().computer, close: onClose };
}

test("releases both task connections and creates fresh controls for a follow-up", async () => {
  const closed: ComputerMode[] = [];
  const sessions = new ComputerSessions((mode) =>
    fixture(async () => {
      closed.push(mode);
    }),
  );
  const browser = sessions.get("browser");
  const desktop = sessions.get("desktop");
  await sessions.release();
  expect(closed.toSorted()).toEqual(["browser", "desktop"]);
  expect(sessions.get("browser")).not.toBe(browser);
  expect(sessions.get("desktop")).not.toBe(desktop);
  await sessions.close();
  expect(closed).toHaveLength(SURFACE_COUNT * TWO_TASKS);
});

test("terminal close joins task cleanup and closes each driver once", async () => {
  const gate = Promise.withResolvers<boolean>();
  let closes = 0;
  const sessions = new ComputerSessions(() =>
    fixture(async () => {
      closes += 1;
      await gate.promise;
    }),
  );
  sessions.get("desktop");
  sessions.get("browser");
  const release = sessions.release();
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
  gate.resolve(true);
  await Promise.all([release, firstClose, observed]);
  expect(closes).toBe(SURFACE_COUNT);
  expect(finished).toBe(true);
});

test("closing unused sessions prevents later driver creation", async () => {
  let created = 0;
  const sessions = new ComputerSessions(() => {
    created += 1;
    return fixture(async () => {
      /* No driver was created. */
    });
  });
  await sessions.close();
  await sessions.close();
  expect(created).toBe(0);
  expect(() => sessions.get("desktop")).toThrow("closed");
});
