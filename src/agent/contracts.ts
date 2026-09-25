import { z } from "zod";
import type { ReadonlyDeep } from "type-fest";

const desktopSchema = z.object({
  apps: z.array(
    z.object({ bundle_id: z.string().optional(), name: z.string(), pid: z.number().int() }),
  ),
  windows: z.array(
    z.object({
      app_name: z.string(),
      pid: z.number().int(),
      title: z.string(),
      window_id: z.number().int(),
    }),
  ),
});

const windowSchema = z.object({
  url: z.url().optional(),
  app_name: z.string(),
  elements: z.array(
    z.object({
      element_index: z.number().int(),
      element_token: z.string(),
      role: z.string(),
      label: z.string().optional(),
      href: z.url().optional(),
      value: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
      actions: z.array(z.string()).optional(),
      frame: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).optional(),
    }),
  ),
  pid: z.number().int(),
  snapshot_id: z.string(),
  window_id: z.number().int(),
  window_title: z.string().default(""),
});

type Desktop = ReadonlyDeep<z.infer<typeof desktopSchema>>;
type Window = ReadonlyDeep<z.infer<typeof windowSchema>>;
interface Observation {
  readonly desktop: Desktop;
  readonly window?: Window;
}

const MAX_REASON_LENGTH = 280;
const reason = z.string().min(1).max(MAX_REASON_LENGTH);
const target = { pid: z.number().int().nonnegative(), window_id: z.number().int().nonnegative() };
const actionSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("select_surface"),
    surface: z.enum(["browser", "desktop"]),
    reason,
  }),
  z.strictObject({ kind: z.literal("request_url"), reason }),
  z.strictObject({ kind: z.literal("request_app"), reason }),
  z.strictObject({ kind: z.literal("refresh"), reason }),
  z.strictObject({ kind: z.literal("blocked"), reason }),
  z.strictObject({ kind: z.literal("compose_text"), ...target, element_token: z.string(), reason }),
  z.strictObject({ kind: z.literal("launch_app"), name: z.string().min(1), reason }),
  z.strictObject({ kind: z.literal("observe_window"), ...target, reason }),
  z.strictObject({
    kind: z.literal("click_element"),
    ...target,
    element_token: z.string(),
    reason,
  }),
  z.strictObject({
    kind: z.literal("type_text"),
    ...target,
    element_token: z.string(),
    text: z.string(),
    reason,
  }),
  z.strictObject({
    kind: z.literal("press_key"),
    ...target,
    key: z.string().min(1),
    modifiers: z.array(z.enum(["cmd", "shift", "option", "ctrl", "fn"])).default([]),
    reason,
  }),
  z.strictObject({ kind: z.literal("navigate"), reason, url: z.url() }),
  z.strictObject({ kind: z.literal("finish"), reason, summary: z.string().min(1) }),
]);
type Action = ReadonlyDeep<z.infer<typeof actionSchema>>;
type ActionChoices = readonly [Action, ...Action[]];
type ElementAction = Extract<Action, { kind: "click_element" | "compose_text" | "type_text" }>;
function validElement(action: ElementAction, window: Window): boolean {
  const element = window.elements.find(
    (candidate) => candidate.element_token === action.element_token,
  );
  if (element === undefined) {
    return false;
  }
  if (action.kind === "click_element") {
    return (element.actions ?? []).some((name) =>
      ["AXPress", "AXPick", "AXConfirm", "AXOpen"].includes(name),
    );
  }
  return (
    ["AXTextField", "AXTextArea", "textbox", "searchbox", "combobox"].includes(element.role) ||
    (element.actions ?? []).includes("AXSetValue")
  );
}
function validNavigation(url: string, observation: Observation): boolean {
  return (
    Boolean(observation.window) && ["http:", "https:", "about:"].includes(new URL(url).protocol)
  );
}
function matchesWindow(action: Extract<Action, { pid: number }>, window: Window): boolean {
  return window.pid === action.pid && window.window_id === action.window_id;
}

function validateActions(actions: readonly Action[], observation: Observation): Action[] {
  return actions.filter((action) => {
    switch (action.kind) {
      case "launch_app":
      case "finish":
      case "blocked":
      case "select_surface":
      case "request_url":
      case "request_app":
      case "refresh": {
        return true;
      }
      case "click_element":
      case "compose_text":
      case "navigate":
      case "observe_window":
      case "press_key":
      case "type_text": {
        break;
      }
    }
    if (action.kind === "navigate") {
      return validNavigation(action.url, observation);
    }
    const exists = observation.desktop.windows.some(
      (window) => window.pid === action.pid && window.window_id === action.window_id,
    );
    if (!exists) {
      return false;
    }
    if (action.kind === "observe_window") {
      return true;
    }
    if (!observation.window || !matchesWindow(action, observation.window)) {
      return false;
    }
    if (action.kind === "press_key") {
      return true;
    }
    return validElement(action, observation.window);
  });
}

function describeAction(action: Action): string {
  switch (action.kind) {
    case "select_surface": {
      return action.reason;
    }
    case "request_url": {
      return action.reason;
    }
    case "request_app": {
      return action.reason;
    }
    case "compose_text": {
      return action.reason;
    }
    case "refresh": {
      return action.reason;
    }
    case "blocked": {
      return action.reason;
    }
    case "launch_app": {
      return `Open application ${action.name}. ${action.reason}`;
    }
    case "observe_window": {
      return action.reason;
    }
    case "click_element": {
      return `Click. ${action.reason}`;
    }
    case "type_text": {
      return `Type ${JSON.stringify(action.text)}. ${action.reason}`;
    }
    case "press_key": {
      return `Press ${[...action.modifiers, action.key].join("+")}. ${action.reason}`;
    }
    case "navigate": {
      return `Open ${action.url} in the current browser tab. ${action.reason}`;
    }
    case "finish": {
      return action.reason;
    }
    default: {
      throw new Error("Unexpected action");
    }
  }
}

export { actionSchema, describeAction, desktopSchema, validateActions, windowSchema };
export type { Action, ActionChoices, Desktop, Observation, Window };
