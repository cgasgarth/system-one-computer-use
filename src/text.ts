import { z } from 'zod';
import { proposalSchema, type Action, type Observation } from './contracts';

export interface TextModel {
  propose(task: string, observation: Observation, history: string[]): Promise<Action[]>;
}

const completionSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1),
});

export class ChatCompletionTextModel implements TextModel {
  constructor(private readonly endpoint: string, private readonly modelId: string,
              private readonly apiKey?: string) {}

  async propose(task: string, observation: Observation, history: string[]): Promise<Action[]> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}) },
      body: JSON.stringify({ model: this.modelId, temperature: 0, max_tokens: 700,
        messages: [
          { role: 'system', content: `You propose next actions for a computer-use agent. Return one JSON object with an "actions" array of 1 to 8 candidate actions. No Markdown. Valid kinds: launch_app {name,reason}; observe_window {pid,window_id,reason}; click_element {pid,window_id,element_token,reason}; type_text {pid,window_id,element_token,text,reason}; press_key {pid,window_id,key,modifiers,reason}; finish {summary,reason}. Use only pid/window_id values in the observation. Use only element_token values in the current window. The harness will reject invented or stale values. Propose finish only when the observation proves the task is complete. Keep generated text exact and short.` },
          { role: 'user', content: JSON.stringify({ task, observation: {
            windows: observation.desktop.windows,
            currentWindow: observation.window && {
              pid: observation.window.pid, window_id: observation.window.window_id,
              title: observation.window.window_title,
              elements: observation.window.elements.filter(e => e.label || e.actions?.length || e.value !== undefined).slice(0, 100).map(e => ({
                token: e.element_token, role: e.role, label: e.label, value: e.value, actions: e.actions,
              })),
            },
          }, history: history.slice(-5) }) },
        ],
      }),
    });
    if (!response.ok) throw new Error(`Text model HTTP ${response.status}: ${(await response.text()).slice(0, 600)}`);
    const content = completionSchema.parse(await response.json()).choices[0].message.content;
    let proposal: unknown;
    try { proposal = JSON.parse(content); }
    catch { throw new Error(`Text model did not return JSON: ${content.slice(0, 350)}`); }
    return proposalSchema.parse(proposal).actions;
  }
}
