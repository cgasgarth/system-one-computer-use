import { expect, test } from "bun:test";
import { SurfaceSession } from "../src/agent/surface.ts";
import { CuaError } from "../src/computer/errors.ts";
import { WindowUnavailableError } from "../src/computer/window-unavailable.ts";
import type { ManagedComputer } from "../src/computer/types.ts";
import { computerFixture, desktopFixture, expectFailure, windowFixture } from "./fixtures.ts";

const REPLACEMENT_ID = 10;
const OTHER_ID = 11;
for (const ambiguous of [false, true]) {
  test(`rediscovery binds only one same-process replacement (ambiguous: ${ambiguous})`, async () => {
    const desktop = desktopFixture();
    const original = windowFixture();
    let reads = 0;
    const windows: number[] = [];
    const computer: ManagedComputer = {
      ...computerFixture().computer,
      async desktop() {
        reads += 1;
        return reads === 1
          ? desktop
          : {
              ...desktop,
              windows: (ambiguous ? [REPLACEMENT_ID, OTHER_ID] : [REPLACEMENT_ID]).map((id) => ({
                pid: original.pid,
                app_name: original.app_name,
                title: "Result",
                window_id: id,
              })),
            };
      },
      async window(_pid, id) {
        windows.push(id);
        if (id === original.window_id) {
          throw new WindowUnavailableError("Window was replaced");
        }
        return { ...original, window_id: id, window_title: "Result" };
      },
    };
    const session = new SurfaceSession();
    session.mode = "desktop";
    session.selectApplication(desktop.apps[0]);
    session.setTarget({ pid: original.pid, windowId: original.window_id });
    const observation = await session.observe(() => computer);
    expect(observation.window?.window_id).toBe(ambiguous ? undefined : REPLACEMENT_ID);
    expect(windows).toEqual(
      ambiguous ? [original.window_id] : [original.window_id, REPLACEMENT_ID],
    );
  });
}

test("permission errors propagate without selecting another window", async () => {
  const desktop = desktopFixture();
  const original = windowFixture();
  const computer: ManagedComputer = {
    ...computerFixture().computer,
    async window() {
      throw new CuaError("Permission denied");
    },
  };
  const session = new SurfaceSession();
  session.mode = "desktop";
  session.selectApplication(desktop.apps[0]);
  session.setTarget({ pid: original.pid, windowId: original.window_id });
  await expectFailure(
    session.observe(() => computer),
    "Permission denied",
  );
});
