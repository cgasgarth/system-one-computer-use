import type { Action, ActionChoices, Observation, Window } from "./contracts.ts";
import { isEditableElement, validateActions } from "./contracts.ts";
import { textTargetName } from "./controls.ts";
import { normalizedHttpUrl, taskUrls } from "./url-addresses.ts";
import type { Surface } from "../app/sessions/schema.ts";

const OPERATIONS = [
  { capability: "AXPress", operation: "press", verb: "Activate" },
  { capability: "AXPick", operation: "pick", verb: "Pick" },
  { capability: "AXConfirm", operation: "confirm", verb: "Submit text in" },
  { capability: "AXOpen", operation: "open", verb: "Open" },
] as const;
const MAX_REASON = 280;
const SINGLE_LINE_INPUT_ROLES = new Set(["AXTextField", "textbox", "searchbox"]);
const CHOICE_ROLES = new Set(["AXPopUpButton", "AXList", "combobox", "listbox", "option"]);
const DIALOG_ROLES = new Set(["AXDialog", "AXSheet", "AXPopover", "dialog", "alertdialog"]);
interface OptionContext {
  readonly task?: string;
  readonly previousSurface?: Surface;
  readonly needsApplication?: boolean;
  readonly mode: "browser" | "desktop" | undefined;
  readonly observation: Observation;
  readonly applications: readonly string[];
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
function descendantOf(
  element: Window["elements"][number],
  ancestor: number,
  elements: ReadonlyMap<number, Window["elements"][number]>,
): boolean {
  let parent = element.parent_index;
  const visited = new Set<number>();
  while (parent !== undefined && parent !== null && !visited.has(parent)) {
    visited.add(parent);
    if (parent === ancestor) {
      return true;
    }
    parent = elements.get(parent)?.parent_index;
  }
  return false;
}
function controlName(element: Window["elements"][number], window: Window): string | undefined {
  const label = element.label?.trim();
  if (label !== undefined && label.length > 0 && label !== element.role) {
    return label;
  }
  if (typeof element.value !== "string" && typeof element.value !== "number") {
    if (!["AXRow", "AXCell"].includes(element.role)) {
      return undefined;
    }
    const byIndex = new Map(window.elements.map((item) => [item.element_index, item]));
    return window.elements
      .find((item) => {
        const text = item.label?.trim();
        return (
          (item.role === "AXStaticText" ||
            (item.role === "AXTextField" && !isEditableElement(item))) &&
          text !== undefined &&
          text.length > 0 &&
          descendantOf(item, element.element_index, byIndex)
        );
      })
      ?.label?.trim();
  }
  const value = String(element.value).trim();
  return value.length > 0 ? value : undefined;
}
function keyboardOptions(
  window: Window,
): readonly { readonly key: string; readonly token: string }[] {
  const focused = window.elements.filter(
    (element) => element.focused === true && element.enabled !== false,
  );
  const [control] = focused;
  if (focused.length !== 1 || control === undefined) {
    return [];
  }
  const text = SINGLE_LINE_INPUT_ROLES.has(control.role) && isEditableElement(control);
  const choice = CHOICE_ROLES.has(control.role);
  const confirm = control.actions?.includes("AXConfirm") === true;
  const dialog = window.elements.some((element) => DIALOG_ROLES.has(element.role));
  const keys = [
    ...(text || choice || confirm ? ["return"] : []),
    ...(dialog || choice ? ["escape"] : []),
    ...(text || choice ? ["tab"] : []),
    ...(choice ? ["down", "up"] : []),
  ];
  return keys.map((key) => ({ key, token: control.element_token }));
}
function windowInputs(window: Window): Action[] {
  const actions: Action[] = [];
  for (const element of window.elements.filter((item) => item.enabled !== false)) {
    const name = controlName(element, window);
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
  const keys = keyboardOptions(window);
  for (const { key, token } of keys) {
    actions.push({
      kind: "press_key",
      pid: window.pid,
      window_id: window.window_id,
      element_token: token,
      key,
      modifiers: [],
      reason: `Press ${key}`,
    });
  }
  return actions;
}
function browserDestinations(context: OptionContext): Action[] {
  const supplied = taskUrls(context.task ?? "");
  const previous =
    context.previousSurface?.kind === "browser"
      ? normalizedHttpUrl(context.previousSurface.url)
      : undefined;
  const current = normalizedHttpUrl(context.observation.window?.url ?? "");
  return [
    ...supplied.map((url): Action => ({
      kind: "navigate",
      url,
      reason: `Open supplied URL ${url}`.slice(0, MAX_REASON),
    })),
    ...(previous === undefined || previous === current || supplied.includes(previous)
      ? []
      : [
          {
            kind: "navigate" as const,
            url: previous,
            reason:
              `Return to previous session browser page ${JSON.stringify(context.previousSurface?.title ?? "")} at ${previous}`.slice(
                0,
                MAX_REASON,
              ),
          },
        ]),
    { kind: "request_url", reason: "Open a URL in Chrome." },
  ];
}
function surfaceOptions(context: OptionContext): Action[] {
  if (context.observationFailed === true) {
    return [];
  }
  if (context.mode === "desktop" && context.needsApplication === true) {
    return context.applications.map((name): Action => ({
      kind: "request_app",
      name,
      reason: `Open installed application ${name}`.slice(0, MAX_REASON),
    }));
  }
  const actions = desktopTargets(context);
  if (context.mode === "desktop") {
    actions.push(
      ...context.applications
        .filter((name) => context.observation.window?.app_name !== name)
        .map((name): Action => ({
          kind: "request_app",
          name,
          reason: `Open installed application ${name}`.slice(0, MAX_REASON),
        })),
    );
  }
  if (context.mode === "browser") {
    actions.push(...browserDestinations(context));
  }
  if (context.mode !== undefined && context.observation.window !== undefined) {
    const { window } = context.observation;
    const blankBrowser =
      context.mode === "browser" && window.url === "about:blank" && window.elements.length === 0;
    if (!blankBrowser) {
      actions.push(...windowInputs(window));
    }
    if (context.mode === "desktop") {
      actions.push(
        ...(window.menus ?? [])
          .filter((menu) => menu.enabled)
          .map((menu): Action => ({
            kind: "invoke_menu",
            pid: window.pid,
            window_id: window.window_id,
            path: menu.path,
            reason: `Choose menu ${menu.path.join(" > ")}`.slice(0, MAX_REASON),
          })),
      );
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
