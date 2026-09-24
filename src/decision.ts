import { z } from 'zod';
import { describeAction, type Action, type Observation } from './contracts';

export interface DecisionModel {
  choose(task: string, observation: Observation, actions: Action[]): Promise<{
    action: Action; probabilities: Record<string, number>; latencyMs: number;
  }>;
}

const answerSchema = z.object({
  answers: z.object({
    next_action: z.object({
      choice: z.string(),
      probabilities: z.record(z.string(), z.number().finite()),
    }),
  }),
});

export class SystemOneHttpDecisionModel implements DecisionModel {
  constructor(private readonly endpoint: string, private readonly modelId: string) {}

  async choose(task: string, observation: Observation, actions: Action[]) {
    const criteria = Object.fromEntries(actions.map((action, index) => [`A${index}`, describeAction(action)]));
    const state = [
      `Task: ${task}`,
      `Windows: ${observation.desktop.windows.map(w => `${w.app_name} (${w.pid}/${w.window_id}): ${w.title}`).join(' | ') || 'none'}`,
      observation.window ? `Current window: ${observation.window.app_name}: ${observation.window.window_title}` : 'No window selected.',
      observation.window ? `Visible controls and values: ${observation.window.elements.slice(0, 100).map(e =>
        `${e.role} ${e.label || ''} ${String(e.value ?? '').slice(0, 100)}`).join(' | ').slice(0, 6000)}` : '',
    ].join('\n');
    const start = performance.now();
    const response = await fetch(this.endpoint, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(10000),
      body: JSON.stringify({
        model: this.modelId, state,
        questions: { next_action: {
          type: 'choice',
          instructions: 'Choose the one next computer action that best advances the task. Choose finish only when the observed state shows the task is complete.',
          criteria,
        } },
      }),
    });
    if (!response.ok) throw new Error(`System One HTTP ${response.status}: ${(await response.text()).slice(0, 600)}`);
    const answer = answerSchema.parse(await response.json()).answers.next_action;
    const latencyMs = performance.now() - start;
    const index = Number(answer.choice.slice(1));
    if (!/^A\d+$/.test(answer.choice) || !Number.isInteger(index) || !actions[index]) {
      throw new Error(`System One selected unknown action ${JSON.stringify(answer.choice)}`);
    }
    const probabilitySum = Object.values(answer.probabilities).reduce((sum, value) => sum + value, 0);
    if (Math.abs(probabilitySum - 1) > 0.02 || Object.keys(answer.probabilities).length !== actions.length
        || Object.keys(criteria).some(key => !(key in answer.probabilities))) {
      throw new Error('System One returned an invalid action probability distribution');
    }
    return { action: actions[index], probabilities: answer.probabilities, latencyMs };
  }
}
