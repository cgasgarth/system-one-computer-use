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
      parent_index: z.number().int().nullable().optional(),
      element_token: z.string(),
      role: z.string(),
      label: z.string().optional(),
      placeholder: z.string().optional(),
      href: z.url().optional(),
      value: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
      actions: z.array(z.string()).optional(),
      enabled: z.boolean().optional(),
      selected: z.boolean().optional(),
      focused: z.boolean().optional(),
      editable: z.boolean().optional(),
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
  readonly application?: Desktop["apps"][number];
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
  z.strictObject({
    kind: z.literal("open_document"),
    pid: z.number().int().positive(),
    name: z.string().min(1),
    reason,
  }),
  z.strictObject({ kind: z.literal("refresh"), reason }),
  z.strictObject({ kind: z.literal("blocked"), reason }),
  z.strictObject({ kind: z.literal("compose_text"), ...target, element_token: z.string(), reason }),
  z.strictObject({ kind: z.literal("observe_window"), ...target, reason }),
  z.strictObject({
    kind: z.literal("click_element"),
    operation: z.enum(["press", "pick", "confirm", "open"]).optional(),
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
const TEXT_INPUT_ROLES = new Set(["AXTextField", "textbox", "searchbox", "combobox", "spinbutton"]);
function isEditableElement(element: Window["elements"][number]): boolean {
  if (element.editable !== undefined) {
    return element.editable && element.enabled !== false;
  }
  const capabilities = element.actions ?? [];
  return (
    element.enabled !== false &&
    (capabilities.includes("AXSetValue") ||
      (TEXT_INPUT_ROLES.has(element.role) && !capabilities.includes("AXOpen")))
  );
}
function validElement(action: ElementAction, window: Window): boolean {
  const element = window.elements.find(
    (candidate) => candidate.element_token === action.element_token,
  );
  if (element === undefined || element.enabled === false) {
    return false;
  }
  if (action.kind === "click_element") {
    const operations = {
      press: "AXPress",
      pick: "AXPick",
      confirm: "AXConfirm",
      open: "AXOpen",
    } as const;
    return (element.actions ?? []).includes(operations[action.operation ?? "press"]);
  }
  return isEditableElement(element);
}
function validNavigation(url: string, observation: Observation): boolean {
  return (
    Boolean(observation.window) && ["http:", "https:", "about:"].includes(new URL(url).protocol)
  );
}
function matchesWindow(action: Extract<Action, { window_id: number }>, window: Window): boolean {
  return window.pid === action.pid && window.window_id === action.window_id;
}

function validateActions(actions: readonly Action[], observation: Observation): Action[] {
  return actions.filter((action) => {
    if (action.kind === "open_document") {
      return observation.desktop.apps.some(
        (app) => app.pid === action.pid && app.name === action.name,
      );
    }
    if (action.kind === "navigate") {
      return validNavigation(action.url, observation);
    }
    if (!("pid" in action)) {
      return true;
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
    case "open_document": {
      return action.reason;
    }
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
    case "observe_window": {
      return action.reason;
    }
    case "click_element": {
      return action.operation === "confirm" ? action.reason : `Click. ${action.reason}`;
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

export {
  actionSchema,
  describeAction,
  desktopSchema,
  isEditableElement,
  validateActions,
  windowSchema,
};
export type { Action, ActionChoices, Desktop, Observation, Window };
