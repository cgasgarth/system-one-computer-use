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
const planFields = {
  app: z.string().min(1).optional(),
  targetLabel: z.string().min(1).optional(),
  textToEnter: z.string().min(1).optional(),
  url: z.url().optional(),
};
const openUrlPlan = z.strictObject({ ...planFields, goal: z.literal("open_url"), url: z.url() });
const openAppPlan = z.strictObject({
  ...planFields,
  app: z.string().min(1),
  goal: z.literal("open_app"),
});
const generalPlan = z.strictObject({ ...planFields, goal: z.literal("task") });
const taskPlanSchema = z.discriminatedUnion("goal", [openUrlPlan, openAppPlan, generalPlan]);
type TaskPlan = ReadonlyDeep<z.infer<typeof taskPlanSchema>>;

function validateActions(actions: readonly Action[], observation: Observation): Action[] {
  return actions.filter((action) => {
    if (action.kind === "launch_app" || action.kind === "finish") {
      return true;
    }
    if (action.kind === "navigate") {
      return (
        Boolean(observation.window) &&
        ["http:", "https:", "about:"].includes(new URL(action.url).protocol)
      );
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
    if (
      !observation.window ||
      observation.window.pid !== action.pid ||
      observation.window.window_id !== action.window_id
    ) {
      return false;
    }
    if (action.kind === "press_key") {
      return true;
    }
    const element = observation.window.elements.find(
      (candidate) => candidate.element_token === action.element_token,
    );
    if (!element) {
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
  });
}

function describeAction(action: Action): string {
  switch (action.kind) {
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
      return `The task is complete: ${action.summary}. ${action.reason}`;
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
  taskPlanSchema,
  validateActions,
  windowSchema,
};
export type { Action, ActionChoices, Desktop, Observation, TaskPlan, Window };
