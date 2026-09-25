import type { Action, ActionChoices, Observation, Window } from "./contracts.ts";
import { validateActions } from "./contracts.ts";

const EDITABLE = new Set(["AXTextField", "AXTextArea", "textbox", "searchbox"]);
const CLICKABLE = new Set(["AXPress", "AXPick", "AXConfirm", "AXOpen"]);
const MAX_REASON = 280;
interface OptionContext {
  readonly mode: "browser" | "desktop" | undefined;
  readonly observation: Observation;
  readonly applications: readonly string[];
  readonly choosingWindow?: boolean;
  readonly canOpenDocument?: boolean;
  readonly observationFailed?: boolean;
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
  if (context.mode !== "desktop" || context.choosingWindow !== true) {
    return [];
  }
  return context.observation.desktop.windows.map((target): Action => ({
    kind: "observe_window",
    pid: target.pid,
    window_id: target.window_id,
    reason: `Inspect ${target.app_name}: ${target.title}`.slice(0, MAX_REASON),
  }));
}
function controlName(element: Window["elements"][number]): string | undefined {
  const label = element.label?.trim();
  if (label !== undefined && label.length > 0 && label !== element.role) {
    return label;
  }
  if (typeof element.value !== "string" && typeof element.value !== "number") {
    return undefined;
  }
  const value = String(element.value).trim();
  return value.length > 0 ? value : undefined;
}
function windowInputs(window: Window): Action[] {
  const actions: Action[] = [];
  for (const element of window.elements) {
    const name = controlName(element);
    const target = {
      pid: window.pid,
      window_id: window.window_id,
      element_token: element.element_token,
    };
    const capabilities = element.actions ?? [];
    if (
      capabilities.includes("AXSetValue") ||
      (EDITABLE.has(element.role) && !capabilities.includes("AXOpen"))
    ) {
      actions.push({
        ...target,
        kind: "compose_text",
        reason:
          `Fill the ${JSON.stringify(name ?? element.role)} text box with the text requested by the user.`.slice(
            0,
            MAX_REASON,
          ),
      });
    }
    if (name !== undefined && capabilities.some((action) => CLICKABLE.has(action))) {
      actions.push({
        ...target,
        kind: "click_element",
        reason: `Activate ${name}`.slice(0, MAX_REASON),
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
function surfaceOptions(context: OptionContext): Action[] {
  if (context.observationFailed === true) {
    return [];
  }
  const actions = desktopTargets(context);
  if (context.mode === "desktop") {
    if (context.canOpenDocument === true && context.observation.application !== undefined) {
      const { name, pid } = context.observation.application;
      actions.push({
        kind: "open_document",
        name,
        pid,
        reason: `Use ${name}'s Open command (Command+O) to choose a file.`.slice(0, MAX_REASON),
      });
    }
    if (context.choosingWindow !== true) {
      actions.push({
        kind: "request_window",
        reason: "Select an existing application window to inspect or control.",
      });
    }
    actions.push({
      kind: "request_app",
      reason:
        context.observation.window === undefined
          ? "Open an installed application on this Mac."
          : "Switch to another installed Mac application.",
    });
  }
  if (context.mode === "browser") {
    actions.push({
      kind: "request_url",
      reason: "Open a URL in Chrome.",
    });
  }
  if (context.mode !== undefined && context.observation.window !== undefined) {
    actions.push(...windowInputs(context.observation.window));
  }
  return actions;
}
function options(context: OptionContext): ActionChoices {
  const actions = [...switches(context.mode), ...surfaceOptions(context)];
  if (context.mode !== undefined) {
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
