import { expect } from "bun:test";
import { z } from "zod";
import type { Desktop, Window } from "../src/agent/contracts.ts";
import type { ManagedComputer } from "../src/computer/types.ts";
import type { TextModel } from "../src/models/text.ts";

function desktopFixture(): Desktop {
  return {
    apps: [{ name: "Messages", pid: 7 }],
    windows: [{ app_name: "Messages", pid: 7, title: "Messages", window_id: 9 }],
  };
}
function windowFixture(): Window {
  return {
    app_name: "Messages",
    pid: 7,
    window_id: 9,
    window_title: "Messages",
    snapshot_id: "s1",
    elements: [
      {
        element_index: 1,
        element_token: "s1:1",
        role: "AXTextField",
        label: "Search",
        value: "",
        actions: ["AXPress", "AXSetValue"],
      },
    ],
  };
}
function computerFixture(): { computer: ManagedComputer; typed: string[] } {
  const typed: string[] = [];
  const computer: ManagedComputer = {
    async desktop() {
      return desktopFixture();
    },
    async window() {
      const window = windowFixture();
      return {
        ...window,
        elements: window.elements.map((element) => ({
          element_index: element.element_index,
          element_token: element.element_token,
          role: element.role,
          label: "Search",
          actions: ["AXPress", "AXSetValue"],
          value: typed.at(-1) ?? "",
        })),
      };
    },
    async clickElement() {
      /* This fixture records text input only. */
    },
    // eslint-disable-next-line typescript/promise-function-async
    inspectClick() {
      return Promise.resolve({ kind: "unclassified" });
    },
    async launchApp() {
      /* This fixture records text input only. */
    },
    async pressKey() {
      /* This fixture records text input only. */
    },
    async navigate() {
      /* This fixture records text input only. */
    },
    async close() {
      /* This fixture records text input only. */
    },
    async typeText(action) {
      typed.push(action.text);
    },
  };
  return { computer, typed };
}
function textFixture(): TextModel {
  return {
    async generate() {
      return "Alex";
    },
  };
}
async function expectFailure<Result>(promise: Promise<Result>, message: string): Promise<void> {
  try {
    await promise;
  } catch (error) {
    expect(z.instanceof(Error).parse(error).message).toContain(message);
    return;
  }
  throw new Error("Expected a rejection");
}
export { desktopFixture, windowFixture, computerFixture, textFixture, expectFailure };
