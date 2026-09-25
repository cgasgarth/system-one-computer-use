import type { Action, ActionChoices, Observation, Window } from "./contracts.ts";
import { validateActions } from "./contracts.ts";

const EDITABLE = new Set(["AXTextField", "AXTextArea", "textbox", "searchbox"]);
const CLICKABLE = new Set(["AXPress", "AXPick", "AXConfirm", "AXOpen"]);
const MAX_REASON = 280;
interface OptionContext {
  readonly mode: "browser" | "desktop" | undefined;
  readonly observation: Observation;
  readonly applications: readonly string[];
}
function switches(mode: OptionContext["mode"]): Action[] {
  const actions: Action[] = [];
  if (mode !== "browser") {
    actions.push({
      kind: "select_surface",
      surface: "browser",
      reason:
        "Use Google Chrome browser tools to browse websites, search the web, and control browser tabs.",
    });
  }
  if (mode !== "desktop") {
    actions.push({
      kind: "select_surface",
      surface: "desktop",
      reason: "Open or interact with an app on this Mac.",
    });
  }
  return actions;
}
function desktopTargets(context: OptionContext): Action[] {
  if (context.mode !== "desktop" || context.observation.window !== undefined) {
    return [];
  }
  return context.observation.desktop.windows.map((target): Action => ({
    kind: "observe_window",
    pid: target.pid,
    window_id: target.window_id,
    reason: `Inspect ${target.app_name}: ${target.title}`.slice(0, MAX_REASON),
  }));
}
function windowInputs(window: Window): Action[] {
  const actions: Action[] = [];
  for (const element of window.elements) {
    const target = {
      pid: window.pid,
      window_id: window.window_id,
      element_token: element.element_token,
    };
    if (EDITABLE.has(element.role)) {
      actions.push({
        ...target,
        kind: "compose_text",
        reason: `Request and enter text for ${element.label ?? element.role}`.slice(0, MAX_REASON),
      });
    } else if ((element.actions ?? []).some((name) => CLICKABLE.has(name))) {
      actions.push({
        ...target,
        kind: "click_element",
        reason: `Activate ${element.label ?? element.role}`.slice(0, MAX_REASON),
      });
    }
  }
  for (const key of ["return", "escape", "tab", "down", "up"]) {
    actions.push({
      kind: "press_key",
      pid: window.pid,
      window_id: window.window_id,
      key,
      modifiers: [],
      reason: `Press ${key}`,
    });
  }
  return actions;
}
function options(context: OptionContext): ActionChoices {
  const actions = [...switches(context.mode), ...desktopTargets(context)];
  if (context.mode === "desktop") {
    actions.push({
      kind: "request_app",
      reason:
        context.observation.window === undefined
          ? "Open an application on this Mac. Request the application name as a text argument from the text helper."
          : "Switch to another installed Mac application. Request its name as a text argument from the text helper.",
    });
  }
  if (context.mode === "browser") {
    actions.push({
      kind: "request_url",
      reason: "Navigate to a website or search URL; request the URL text from the text model",
    });
  }
  if (context.mode !== undefined) {
    if (context.observation.window !== undefined) {
      actions.push(...windowInputs(context.observation.window));
    }
    actions.push({
      kind: "refresh",
      reason: "Observe again to check for updated controls or results",
    });
  }
  actions.push(
    {
      kind: "finish",
      summary: "Task marked complete",
      reason: "Finish: the requested task has already been completed.",
    },
    { kind: "blocked", reason: "Stop: the task cannot proceed without help from the user." },
  );
  const [first, ...rest] = validateActions(actions, context.observation);
  if (first === undefined) {
    throw new Error("No decision options were generated");
  }
  return [first, ...rest];
}
export { options };
