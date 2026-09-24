import { z } from 'zod';

export const desktopSchema = z.object({
  apps: z.array(z.object({ name: z.string(), pid: z.number().int(), bundle_id: z.string().optional() })),
  windows: z.array(z.object({
    app_name: z.string(), pid: z.number().int(), window_id: z.number().int(), title: z.string(),
  })),
});

export const windowSchema = z.object({
  pid: z.number().int(),
  window_id: z.number().int(),
  snapshot_id: z.string(),
  app_name: z.string(),
  window_title: z.string(),
  elements: z.array(z.object({
    element_index: z.number().int(),
    element_token: z.string(),
    role: z.string(),
    label: z.string().optional(),
    value: z.unknown().optional(),
    actions: z.array(z.string()).optional(),
  })),
});

export type Desktop = z.infer<typeof desktopSchema>;
export type Window = z.infer<typeof windowSchema>;
export type Observation = { desktop: Desktop; window?: Window };

const reason = z.string().min(1).max(280);
const target = { pid: z.number().int().nonnegative(), window_id: z.number().int().nonnegative() };
export const actionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('launch_app'), name: z.string().min(1), reason }),
  z.strictObject({ kind: z.literal('observe_window'), ...target, reason }),
  z.strictObject({ kind: z.literal('click_element'), ...target, element_token: z.string(), reason }),
  z.strictObject({ kind: z.literal('type_text'), ...target, element_token: z.string(), text: z.string(), reason }),
  z.strictObject({ kind: z.literal('press_key'), ...target, key: z.string().min(1), modifiers: z.array(z.enum(['cmd', 'shift', 'option', 'ctrl', 'fn'])).default([]), reason }),
  z.strictObject({ kind: z.literal('finish'), summary: z.string().min(1), reason }),
]);
export type Action = z.infer<typeof actionSchema>;
export const proposalSchema = z.strictObject({ actions: z.array(actionSchema).min(1).max(8) });

export function validateActions(actions: Action[], observation: Observation): Action[] {
  return actions.filter(action => {
    if (action.kind === 'launch_app' || action.kind === 'finish') return true;
    const exists = observation.desktop.windows.some(
      w => w.pid === action.pid && w.window_id === action.window_id,
    );
    if (!exists) return false;
    if (action.kind === 'observe_window') return true;
    if (!observation.window || observation.window.pid !== action.pid || observation.window.window_id !== action.window_id) return false;
    if (action.kind === 'press_key') return true;
    const element = observation.window.elements.find(e => e.element_token === action.element_token);
    if (!element) return false;
    if (action.kind === 'click_element') {
      return (element.actions || []).some(name => ['AXPress', 'AXPick', 'AXConfirm', 'AXOpen'].includes(name));
    }
    return element.role.includes('Text') || (element.actions || []).includes('AXSetValue');
  });
}

export function describeAction(action: Action): string {
  switch (action.kind) {
    case 'launch_app': return `Open application ${action.name}. ${action.reason}`;
    case 'observe_window': return `Inspect window ${action.window_id} of process ${action.pid}. ${action.reason}`;
    case 'click_element': return `Click visible element ${action.element_token}. ${action.reason}`;
    case 'type_text': return `Type ${JSON.stringify(action.text)} into visible element ${action.element_token}. ${action.reason}`;
    case 'press_key': return `Press ${[...action.modifiers, action.key].join('+')} in window ${action.window_id}. ${action.reason}`;
    case 'finish': return `The task is complete: ${action.summary}. ${action.reason}`;
  }
}
