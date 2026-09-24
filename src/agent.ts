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
  error?: string;
};
export type TaskResult = {
  task: string;
  summary: string;
  totalMs: number;
  textMs: number;
  requestsPerSecond: number;
  steps: TaskStep[];
};

function taskLooksComplete(plan: TaskPlan, observation: Observation,
                           hasActed: boolean, hasNavigated: boolean,
                           clickedTargetBeforeTitle?: string): boolean {
  const window = observation.window;
  if (!window) return false;
  const status = window.elements.find(element => element.role === 'status' &&
    ['Task pending', 'Task complete', 'Task failed'].includes(element.label || ''));
  if (status) return status.label === 'Task complete';
  const title = window.window_title.toLocaleLowerCase();
  if (plan.targetLabel) {
    const target = plan.targetLabel.toLocaleLowerCase();
    return title.includes(target) ||
      (hasNavigated && clickedTargetBeforeTitle !== undefined &&
       window.window_title !== clickedTargetBeforeTitle);
  }
  if (plan.textToEnter) {
    return hasActed && window.elements.some(element =>
      typeof element.value === 'string' && element.value.includes(plan.textToEnter!));
  }
  if (plan.url) return hasNavigated && title.includes(plan.url.toLocaleLowerCase());
  if (plan.app) return window.app_name.toLocaleLowerCase() === plan.app.toLocaleLowerCase();
  return hasActed;
}

function attemptKey(observation: Observation, action: Action): string {
  const state = observation.window
    ? JSON.stringify([observation.window.window_title,
        observation.window.elements.map(element => [element.role, element.label, element.value])])
    : 'desktop';
  return `${state}|${action.kind}|${action.reason}`;
}

function candidates(task: string, plan: TaskPlan, observation: Observation, hasActed: boolean,
                    canNavigate: boolean, hasNavigated: boolean,
                    clickedTargetBeforeTitle?: string, attempted?: Set<string>): Action[] {
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
    if (canNavigate && plan.url && !hasNavigated) {
      actions.push({ kind: 'navigate', url: plan.url, reason: 'Open the URL in the task' });
    }
    for (const element of observation.window.elements) {
      if (['AXCheckBox', 'AXSwitch', 'AXRadioButton', 'AXStaticText',
           'checkbox', 'switch', 'radio'].includes(element.role)) continue;
      const editable = ['AXTextField', 'AXTextArea', 'textbox', 'searchbox', 'combobox'].includes(element.role);
      if (!editable && (element.actions || []).some(name => ['AXPress', 'AXPick', 'AXConfirm', 'AXOpen'].includes(name))) {
        actions.push({ kind: 'click_element', pid, window_id,
                       element_token: element.element_token,
                       reason: `Activate ${element.label || element.role}` });
      }
      if (plan.textToEnter && element.value !== plan.textToEnter && (editable ||
                               (element.actions || []).includes('AXSetValue'))) {
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
  const canFinish = taskLooksComplete(plan, observation, hasActed, hasNavigated,
                                      clickedTargetBeforeTitle);
  const bounded = actions.slice(0, canFinish ? 63 : 64);
  if (canFinish) bounded.push({ kind: 'finish', summary: task,
                                reason: 'Select only when the observed state proves the task is complete' });
  return validateActions(bounded, observation).filter(action =>
    action.kind === 'finish' || !attempted?.has(attemptKey(observation, action)));
}

export async function runTask(task: string, computer: Computer, text: TextModel,
                              decision: DecisionModel, maxSteps = 16,
                              onStep?: (step: TaskStep) => void): Promise<TaskResult> {
  if (!task.trim()) throw new Error('A text task is required');
  if (!Number.isInteger(maxSteps) || maxSteps < 1) throw new Error('maxSteps must be positive');
  const started = performance.now();
  const plan = await text.prepare(task);
  const textMs = performance.now() - started;
  const steps: TaskStep[] = [];
  let target: { pid: number; windowId: number } | undefined;
  let hasEffectfulAction = false;
  let hasNavigated = false;
  let clickedTargetBeforeTitle: string | undefined;
  const history: string[] = [];
  const attempted = new Set<string>();

  for (let index = 0; index < maxSteps; index++) {
    const desktop = await computer.desktop();
    let window: Observation['window'];
    if (target && desktop.windows.some(w => w.pid === target.pid && w.window_id === target.windowId)) {
      window = await computer.window(target.pid, target.windowId);
    } else {
      target = undefined;
    }
    const observation: Observation = { desktop, window };
    const actions = candidates(task, plan, observation, hasEffectfulAction,
                               !!computer.navigate, hasNavigated, clickedTargetBeforeTitle, attempted);
    if (!actions.length) throw new Error(`No live Cua action is available for task step ${index + 1}`);
    const choice = await decision.choose(task, observation, actions);
    const action = choice.action;
    if (action.kind !== 'finish' && action.kind !== 'observe_window') {
      attempted.add(attemptKey(observation, action));
    }
    try {
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
        if (plan.targetLabel && action.reason.toLocaleLowerCase().includes(plan.targetLabel.toLocaleLowerCase())) {
          clickedTargetBeforeTitle = observation.window?.window_title;
        }
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
      case 'navigate':
        if (!computer.navigate) throw new Error('Browser navigation is unavailable');
        await computer.navigate(action.url);
        hasNavigated = true;
        hasEffectfulAction = true;
        break;
      case 'finish': {
        const totalMs = performance.now() - started;
        steps.push({ index: index + 1, action, probabilities: choice.probabilities,
                     decisionMs: choice.latencyMs, elapsedMs: totalMs });
        onStep?.(steps.at(-1)!);
        return { task, summary: action.summary, totalMs, textMs,
                 requestsPerSecond: steps.length / (totalMs / 1000), steps };
      }
      }
    } catch (error) {
      if (!String(error).includes('Cua ')) throw error;
      const elapsedMs = performance.now() - started;
      steps.push({ index: index + 1, action, probabilities: choice.probabilities,
                   decisionMs: choice.latencyMs, elapsedMs, error: String(error) });
      onStep?.(steps.at(-1)!);
      history.push(`${describeAction(action)} Failed: ${String(error)}`);
      continue;
    }
    const elapsedMs = performance.now() - started;
    steps.push({ index: index + 1, action, probabilities: choice.probabilities,
                 decisionMs: choice.latencyMs, elapsedMs });
    onStep?.(steps.at(-1)!);
    history.push(describeAction(action));
  }
  throw new Error(`Task did not finish within ${maxSteps} decisions; last action: ${history.at(-1) || 'none'}`);
}
