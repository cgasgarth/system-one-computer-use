import { z } from 'zod';
import { taskPlanSchema, type TaskPlan } from './contracts';

export interface TextModel {
  prepare(task: string): Promise<TaskPlan>;
}

const completionSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1),
});

export class ChatCompletionTextModel implements TextModel {
  constructor(private readonly endpoint: string, private readonly modelId: string,
              private readonly apiKey?: string) {}

  async prepare(task: string): Promise<TaskPlan> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      signal: AbortSignal.timeout(15000),
      headers: { 'content-type': 'application/json', ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}) },
      body: JSON.stringify({ model: this.modelId, temperature: 0, max_tokens: 180,
        messages: [
          { role: 'system', content: 'Extract a computer task plan. Return only one JSON object with optional fields: "app" (application display name), "url" (an exact URL written in the task), and "textToEnter" (exact text to type or a short piece of text the task asks you to write). Omit fields the request does not need. Do not choose UI actions. Do not invent dates, people, addresses, URLs, or content.' },
          { role: 'user', content: task },
        ],
      }),
    });
    if (!response.ok) throw new Error(`Text model HTTP ${response.status}: ${(await response.text()).slice(0, 600)}`);
    const content = completionSchema.parse(await response.json()).choices[0].message.content;
    let plan: unknown;
    try { plan = JSON.parse(content); }
    catch { throw new Error(`Text model did not return JSON: ${content.slice(0, 350)}`); }
    return taskPlanSchema.parse(plan);
  }
}
