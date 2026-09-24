import { describeAction, validateActions, type Action, type Observation } from './contracts';
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
  requestsPerSecond: number;
  steps: TaskStep[];
};

export async function runTask(task: string, computer: Computer, text: TextModel,
                              decision: DecisionModel, maxSteps = 16): Promise<TaskResult> {
  if (!task.trim()) throw new Error('A text task is required');
  if (!Number.isInteger(maxSteps) || maxSteps < 1) throw new Error('maxSteps must be positive');
  const started = performance.now();
  const steps: TaskStep[] = [];
  let target: { pid: number; windowId: number } | undefined;
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
    const proposed = await text.propose(task, observation, history);
    const actions = validateActions(proposed, observation);
    if (!actions.length) throw new Error(`Text model proposed no action valid for the current Cua snapshot at step ${index + 1}`);
    const choice = await decision.choose(task, observation, actions);
    const action = choice.action;
    switch (action.kind) {
      case 'observe_window':
        target = { pid: action.pid, windowId: action.window_id };
        break;
      case 'launch_app':
        await computer.launchApp(action.name);
        target = undefined;
        break;
      case 'click_element':
        await computer.clickElement(action.pid, action.window_id, action.element_token);
        break;
      case 'type_text':
        await computer.typeText(action.pid, action.window_id, action.element_token, action.text);
        break;
      case 'press_key':
        await computer.pressKey(action.pid, action.window_id, action.key, action.modifiers);
        break;
      case 'finish': {
        const totalMs = performance.now() - started;
        steps.push({ index: index + 1, action, probabilities: choice.probabilities,
                     decisionMs: choice.latencyMs, elapsedMs: totalMs });
        return { task, summary: action.summary, totalMs,
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
