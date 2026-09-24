import { describeAction, validateActions, type Action, type Observation, type TaskPlan } from './contracts';
import type { Computer } from './cua';
import type { DecisionModel } from './decision';
import type { TextModel } from './text';

export type TaskStep = {
  index: number;
  action: Action;
  probabilities: Record<string, number>;
  decisionMs: number;
  elapsedMs: number;
};
export type TaskResult = {
  task: string;
  summary: string;
  totalMs: number;
  textMs: number;
  requestsPerSecond: number;
  steps: TaskStep[];
};

function candidates(task: string, plan: TaskPlan, observation: Observation, hasActed: boolean): Action[] {
  const actions: Action[] = [];
  if (!observation.window) {
    if (plan.app && !observation.desktop.windows.some(window => window.app_name === plan.app)) {
      actions.push({ kind: 'launch_app', name: plan.app, reason: 'Open the application named in the task' });
    }
    for (const window of observation.desktop.windows) {
      actions.push({ kind: 'observe_window', pid: window.pid, window_id: window.window_id,
                     reason: `Inspect ${window.app_name}: ${window.title}` });
    }
  } else {
    const { pid, window_id } = observation.window;
    for (const element of observation.window.elements) {
      if ((element.actions || []).some(name => ['AXPress', 'AXPick', 'AXConfirm', 'AXOpen'].includes(name))) {
        actions.push({ kind: 'click_element', pid, window_id,
                       element_token: element.element_token,
                       reason: `Activate ${element.label || element.role}` });
      }
      if (plan.textToEnter && (element.role.includes('Text') || (element.actions || []).includes('AXSetValue'))) {
        actions.push({ kind: 'type_text', pid, window_id,
                       element_token: element.element_token, text: plan.textToEnter,
                       reason: `Enter requested text in ${element.label || element.role}` });
      }
    }
    if (plan.textToEnter) {
      actions.push({ kind: 'press_key', pid, window_id, key: 'return', modifiers: [],
                     reason: 'Submit text if the field requires Return' });
    }
  }
  const canFinish = hasActed && !!observation.window;
  const bounded = actions.slice(0, canFinish ? 63 : 64);
  if (canFinish) bounded.push({ kind: 'finish', summary: task,
                                reason: 'Select only when the observed state proves the task is complete' });
  return validateActions(bounded, observation);
}

export async function runTask(task: string, computer: Computer, text: TextModel,
                              decision: DecisionModel, maxSteps = 16): Promise<TaskResult> {
  if (!task.trim()) throw new Error('A text task is required');
  if (!Number.isInteger(maxSteps) || maxSteps < 1) throw new Error('maxSteps must be positive');
  const started = performance.now();
  const plan = await text.prepare(task);
  const textMs = performance.now() - started;
  const steps: TaskStep[] = [];
  let target: { pid: number; windowId: number } | undefined;
  let hasEffectfulAction = false;
  const history: string[] = [];

  for (let index = 0; index < maxSteps; index++) {
    const desktop = await computer.desktop();
    let window: Observation['window'];
    if (target && desktop.windows.some(w => w.pid === target.pid && w.window_id === target.windowId)) {
      window = await computer.window(target.pid, target.windowId);
    } else {
      target = undefined;
    }
    const observation: Observation = { desktop, window };
    const actions = candidates(task, plan, observation, hasEffectfulAction);
    if (!actions.length) throw new Error(`No live Cua action is available for task step ${index + 1}`);
    const choice = await decision.choose(task, observation, actions);
    const action = choice.action;
    switch (action.kind) {
      case 'observe_window':
        target = { pid: action.pid, windowId: action.window_id };
        break;
      case 'launch_app':
        await computer.launchApp(action.name);
        target = undefined;
        hasEffectfulAction = true;
        break;
      case 'click_element':
        await computer.clickElement(action.pid, action.window_id, action.element_token);
        hasEffectfulAction = true;
        break;
      case 'type_text':
        await computer.typeText(action.pid, action.window_id, action.element_token, action.text);
        hasEffectfulAction = true;
        break;
      case 'press_key':
        await computer.pressKey(action.pid, action.window_id, action.key, action.modifiers);
        hasEffectfulAction = true;
        break;
      case 'finish': {
        const totalMs = performance.now() - started;
        steps.push({ index: index + 1, action, probabilities: choice.probabilities,
                     decisionMs: choice.latencyMs, elapsedMs: totalMs });
        return { task, summary: action.summary, totalMs, textMs,
                 requestsPerSecond: steps.length / (totalMs / 1000), steps };
      }
    }
    const elapsedMs = performance.now() - started;
    steps.push({ index: index + 1, action, probabilities: choice.probabilities,
                 decisionMs: choice.latencyMs, elapsedMs });
    history.push(describeAction(action));
  }
  throw new Error(`Task did not finish within ${maxSteps} decisions; last action: ${history.at(-1) || 'none'}`);
}
