import { z } from 'zod';
import { taskPlanSchema, type TaskPlan } from './contracts';

export interface TextModel {
  prepare(task: string): Promise<TaskPlan>;
}

const completionSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1),
});
const rawPlanSchema = z.strictObject({
  app: z.string().optional(), url: z.string().optional(), textToEnter: z.string().optional(),
  targetLabel: z.string().optional(),
});
const planPrompt = `Extract only values that occur in the user's task. Return one JSON object, with no Markdown.
Use app only when the task names an application. Use url only when the task contains that exact full URL.
Use textToEnter only for text the task explicitly asks to type, write, or find in a search field.
Use targetLabel for the named setting, page control, or result that must be reached. Omit unused fields.
Examples:
Open System Settings and find Bluetooth settings -> {"app":"System Settings","textToEnter":"Bluetooth","targetLabel":"Bluetooth"}
Open https://example.com and inspect the page -> {"url":"https://example.com"}
Open https://example.com and click Learn more -> {"url":"https://example.com","targetLabel":"Learn more"}
Type ORD to JFK into the route field -> {"textToEnter":"ORD to JFK"}
Reach the 256 tile in 2048 -> {"targetLabel":"256"}
Return JSON only. Never invent a URL, app, or text.`;

export class ChatCompletionTextModel implements TextModel {
  constructor(private readonly endpoint: string, private readonly modelId: string,
              private readonly apiKey?: string) {}

  async prepare(task: string): Promise<TaskPlan> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      signal: AbortSignal.timeout(15000),
      headers: { 'content-type': 'application/json', ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}) },
      body: JSON.stringify({ model: this.modelId, temperature: 0, max_tokens: 120,
        messages: [
          { role: 'system', content: planPrompt },
          { role: 'user', content: task },
        ],
      }),
    });
    if (!response.ok) throw new Error(`Text model HTTP ${response.status}: ${(await response.text()).slice(0, 600)}`);
    const content = completionSchema.parse(await response.json()).choices[0].message.content.trim();
    const json = content.startsWith('```') && content.endsWith('```')
      ? content.slice(content.indexOf('\n') + 1, -3).trim() : content;
    let plan: unknown;
    try { plan = JSON.parse(json); }
    catch { throw new Error(`Text model did not return JSON: ${content.slice(0, 350)}`); }
    const raw = rawPlanSchema.parse(plan);
    const contains = (value: string) => task.toLocaleLowerCase().includes(value.toLocaleLowerCase());
    return taskPlanSchema.parse({
      ...(raw.app?.trim() && contains(raw.app.trim()) ? { app: raw.app.trim() } : {}),
      ...(raw.url?.trim() && contains(raw.url.trim()) && URL.canParse(raw.url.trim())
        ? { url: raw.url.trim() } : {}),
      ...(raw.textToEnter?.trim() && contains(raw.textToEnter.trim())
        ? { textToEnter: raw.textToEnter.trim() } : {}),
      ...(raw.targetLabel?.trim() && contains(raw.targetLabel.trim())
        ? { targetLabel: raw.targetLabel.trim() } : {}),
    });
  }
}
