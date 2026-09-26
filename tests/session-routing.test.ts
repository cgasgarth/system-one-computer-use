import { expect, test } from "bun:test";
import { runTask } from "../src/agent/loop.ts";
import type { Action, Window } from "../src/agent/contracts.ts";
import type { ManagedComputer } from "../src/computer/types.ts";
import type { DecisionInput } from "../src/models/system-one.ts";
import { computerFixture, windowFixture } from "./fixtures.ts";

const CALENDAR_PID = 20;
const CALENDAR_WINDOW = 21;
const notes = {
  ...windowFixture(),
  app_name: "Notes",
  window_title: "Notes",
  elements: [
    {
      element_index: 1,
      element_token: "new-note",
      role: "AXButton",
      label: "New Note",
      actions: ["AXPress"],
    },
  ],
};
const calendar: Window = {
  ...notes,
  app_name: "Calendar",
  window_title: "Calendar",
  pid: CALENDAR_PID,
  window_id: CALENDAR_WINDOW,
  elements: [
    {
      element_index: 1,
      element_token: "new-event",
      role: "AXButton",
      label: "New Event",
      actions: ["AXPress"],
    },
  ],
};
interface RoutingCase {
  readonly label: string;
  readonly preferredSurface: "desktop" | undefined;
  readonly task: string;
  readonly destination: "Notes" | "Calendar";
}
const cases: RoutingCase[] = [
  {
    label: "auto",
    preferredSurface: undefined,
    task: "Create an event in Calendar",
    destination: "Calendar",
  },
  {
    label: "explicit desktop",
    preferredSurface: "desktop",
    task: "Create an event in Calendar",
    destination: "Calendar",
  },
  {
    label: "same-app follow-up",
    preferredSurface: undefined,
    task: "Add a line to that note",
    destination: "Notes",
  },
];
function chooseAction(input: DecisionInput, acted: boolean): Action {
  let desired: Action["kind"] = "click_element";
  if (acted) {
    desired = "finish";
  } else if (input.mode === undefined) {
    desired = "select_surface";
  } else if (input.observation.window === undefined) {
    desired = "request_app";
  }
  const action = input.actions.find(
    (candidate) =>
      candidate.kind === desired &&
      (candidate.kind !== "select_surface" || candidate.surface === "desktop"),
  );
  if (action === undefined) {
    throw new Error(`Missing ${desired}`);
  }
  return action;
}
test.each(cases)(
  "binds the current request before using saved controls: $label",
  async ({ preferredSurface, task, destination }) => {
    const { computer: base } = computerFixture();
    const launches: string[] = [];
    const actions: string[] = [];
    const computer: ManagedComputer = {
      ...base,
      async desktop() {
        return {
          apps: [
            { name: "Notes", pid: notes.pid },
            { name: "Calendar", pid: calendar.pid },
          ],
          windows: [
            { app_name: "Notes", pid: notes.pid, window_id: notes.window_id, title: "Notes" },
            {
              app_name: "Calendar",
              pid: calendar.pid,
              window_id: calendar.window_id,
              title: "Calendar",
            },
          ],
        };
      },
      async window(pid) {
        if (destination === "Calendar" && pid === notes.pid) {
          throw new Error("Read stale Notes window before binding Calendar");
        }
        return pid === notes.pid ? notes : calendar;
      },
      async launchApp(name) {
        launches.push(name);
      },
      async clickElement(action) {
        actions.push(action.pid === notes.pid ? "Notes" : "Calendar");
      },
    };
    const result = await runTask({
      task,
      applications: ["Notes", "Calendar"],
      context: "Previous request: Open Notes and type hello",
      previousSurface: {
        kind: "desktop",
        pid: notes.pid,
        windowId: notes.window_id,
        app: "Notes",
        title: "Notes",
      },
      ...(preferredSurface === undefined ? {} : { preferredSurface }),
      computer: () => computer,
      text: {
        async generate(input) {
          expect(input.task).toBe(task);
          expect(input.purpose).toBe("application");
          return destination;
        },
      },
      decision: {
        async choose(input) {
          const action = chooseAction(input, actions.length > 0);
          return { action, latencyMs: 1, probabilities: { A0: 1 } };
        },
      },
    });
    expect(result.status).toBe("complete");
    expect(launches).toEqual([destination]);
    expect(actions).toEqual([destination]);
    expect(result.surface?.kind).toBe("desktop");
  },
);
