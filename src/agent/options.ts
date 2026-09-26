import type { Action, ActionChoices, Observation, Window } from "./contracts.ts";
import { isEditableElement, validateActions } from "./contracts.ts";
import { textTargetName } from "./controls.ts";

const OPERATIONS = [
  { capability: "AXPress", operation: "press", verb: "Activate" },
  { capability: "AXPick", operation: "pick", verb: "Pick" },
  { capability: "AXConfirm", operation: "confirm", verb: "Submit text in" },
  { capability: "AXOpen", operation: "open", verb: "Open" },
] as const;
const MAX_REASON = 280;
interface OptionContext {
  readonly needsApplication?: boolean;
  readonly mode: "browser" | "desktop" | undefined;
  readonly observation: Observation;
  readonly applications: readonly string[];
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
  if (context.mode !== "desktop") {
    return [];
  }
  return context.observation.desktop.windows
    .filter(
      (target) =>
        target.pid !== context.observation.window?.pid ||
        target.window_id !== context.observation.window.window_id,
    )
    .map((target): Action => ({
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
function keyboardOptions(window: Window, actions: readonly Action[]): readonly string[] {
  const directControl = actions.some((action) => action.kind === "click_element");
  const focused = !directControl && window.elements.some((element) => element.focused === true);
  const keys = focused ? ["return", "escape", "tab", "down", "up"] : [];
  return keys;
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
    if (isEditableElement(element)) {
      actions.push({
        ...target,
        kind: "compose_text",
        reason: `Type text into ${textTargetName(element)}`.slice(0, MAX_REASON),
      });
    }
    if (name !== undefined) {
      for (const operation of OPERATIONS) {
        const redundantFocus =
          operation.operation === "press" &&
          element.role === "AXTextField" &&
          isEditableElement(element) &&
          capabilities.includes("AXConfirm");
        if (!redundantFocus && capabilities.includes(operation.capability)) {
          actions.push({
            ...target,
            kind: "click_element",
            operation: operation.operation,
            reason: `${operation.verb} ${name}`.slice(0, MAX_REASON),
          });
        }
      }
    }
  }
  const keys = keyboardOptions(window, actions);
  for (const key of keys) {
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
  if (context.mode === "desktop" && context.needsApplication === true) {
    return [
      { kind: "request_app", reason: "Open the application needed for the current user request." },
    ];
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
    const { window } = context.observation;
    const blankBrowser =
      context.mode === "browser" && window.url === "about:blank" && window.elements.length === 0;
    if (!blankBrowser) {
      actions.push(...windowInputs(window));
    }
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
    {
      kind: "blocked",
      reason: "Stop because a required permission, input, or control is unavailable.",
    },
  );
  const [first, ...rest] = validateActions(actions, context.observation);
  if (first === undefined) {
    throw new Error("No decision options were generated");
  }
  return [first, ...rest];
}
export { options };
