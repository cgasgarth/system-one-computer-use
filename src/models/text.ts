import { z } from "zod";
import { taskPlanSchema } from "../agent/contracts.ts";
import type { TaskPlan } from "../agent/contracts.ts";
import { requestJson } from "./request.ts";
import { textResponseSchema } from "./text-schema.ts";
import type { TextRequest } from "./text-schema.ts";
import { computerModeSchema } from "../computer/types.ts";
import type { ComputerMode } from "../computer/types.ts";

interface TextModel {
  readonly prepare: (task: string) => Promise<TaskPlan>;
  readonly route: (task: string) => Promise<ComputerMode>;
}

const TIMEOUT_MS = 15_000;
const MAX_TOKENS = 120;
const ERROR_DETAIL_LIMIT = 350;
const FENCE_LENGTH = 3;
const entryGoalSchema = z.enum(["open_url", "open_app", "enter_text", "task"]);
const entryGoalPrompt = `Classify the task. Reply with one word: open_url, open_app, enter_text, or task. Choose enter_text when the user asks to type into a field, including after navigation.`;
const planPrompt = `Extract only values that occur in the user's task. Return one JSON object, with no Markdown.
Always include goal. Use open_url only if opening or inspecting the URL completes the whole request.
Use open_app only if opening the named app completes the whole request. Otherwise use task.
Use enter_text when entering text in a field is the whole request. Use task if further actions such as submitting are requested.
Navigation before entering text is still enter_text. Opening the URL is preparation, not an extra goal.
Use app only when the task names an application. Use url only when the task contains that exact full URL.
Use textToEnter only for text the task explicitly asks to type, write, or find in a search field.
Use targetLabel for the named setting, page control, or result that must be reached. Omit unused fields.
Examples:
Open Calculator -> {"goal":"open_app","app":"Calculator"}
Open System Settings and find Bluetooth settings -> {"goal":"task","app":"System Settings","textToEnter":"Bluetooth","targetLabel":"Bluetooth"}
Open https://example.com and inspect the page -> {"goal":"open_url","url":"https://example.com"}
Open https://example.com and click Learn more -> {"goal":"task","url":"https://example.com","targetLabel":"Learn more"}
Type ORD to JFK into the route field -> {"goal":"enter_text","textToEnter":"ORD to JFK"}
Open https://example.org and type hello into Message -> {"goal":"enter_text","url":"https://example.org","textToEnter":"hello","targetLabel":"Message"}
Reach the 256 tile in 2048 -> {"goal":"task","targetLabel":"256"}
Return JSON only. Never invent a URL, app, or text.`;

function acceptedText(task: string, value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (trimmed === undefined || trimmed.length === 0) {
    return undefined;
  }
  if (!task.toLocaleLowerCase().includes(trimmed.toLocaleLowerCase())) {
    return undefined;
  }
  return trimmed;
}

function parsePlan(content: string): TaskPlan {
  let json = content.trim();
  if (json.startsWith("```") && json.endsWith("```")) {
    json = json.slice(json.indexOf("\n") + 1, -FENCE_LENGTH).trim();
  }
  try {
    return taskPlanSchema.parse(JSON.parse(json));
  } catch (error) {
    throw new Error(
      `Text model did not return valid task-plan JSON: ${content.slice(0, ERROR_DETAIL_LIMIT)}`,
      { cause: error },
    );
  }
}

function groundedPlan(task: string, raw: TaskPlan): TaskPlan {
  const app = acceptedText(task, raw.app);
  const targetLabel = acceptedText(task, raw.targetLabel);
  const textToEnter = acceptedText(task, raw.textToEnter);
  const url = acceptedText(task, raw.url);
  const fields = {
    ...(app === undefined ? {} : { app }),
    ...(targetLabel === undefined ? {} : { targetLabel }),
    ...(textToEnter === undefined ? {} : { textToEnter }),
    ...(url === undefined ? {} : { url }),
  };
  if (raw.goal === "open_url") {
    if (url === undefined) {
      throw new Error("The planned URL is not present in the task");
    }
    return { ...fields, goal: "open_url", url };
  }
  if (raw.goal === "open_app") {
    if (app === undefined) {
      throw new Error("The planned application is not present in the task");
    }
    return { ...fields, app, goal: "open_app" };
  }
  if (raw.goal === "enter_text") {
    if (textToEnter === undefined) {
      throw new Error("The planned text is not present in the task");
    }
    return { ...fields, goal: "enter_text", textToEnter };
  }
  return { ...fields, goal: "task" };
}

class ChatCompletionTextModel implements TextModel {
  private readonly apiKey: string | undefined;
  private readonly endpoint: string;
  private readonly modelId: string;

  public constructor(endpoint: string, modelId: string, apiKey?: string) {
    this.endpoint = endpoint;
    this.modelId = modelId;
    this.apiKey = apiKey;
  }

  public async route(task: string): Promise<ComputerMode> {
    const response = await requestJson({
      apiKey: this.apiKey,
      body: {
        model: this.modelId,
        temperature: 0,
        max_tokens: MAX_TOKENS,
        messages: [
          {
            role: "system",
            content:
              "Select the computer for this task. Reply with one word: browser or desktop. Use browser for websites, web apps, flights, restaurants, draw.io, and browser games. Use desktop for native macOS applications such as Calculator, Calendar, Finder, or System Settings. If no native app is needed, use browser.",
          },
          {
            role: "user",
            content: `Classify this task, do not execute it: ${JSON.stringify(task)}\nComputer (browser or desktop):`,
          },
        ],
      },
      endpoint: this.endpoint,
      label: "Computer selection",
      schema: textResponseSchema,
      timeoutMs: TIMEOUT_MS,
    });
    return computerModeSchema.parse(response.choices[0].message.content.trim());
  }

  private async entryGoal(task: string): Promise<z.infer<typeof entryGoalSchema>> {
    const response = await requestJson({
      apiKey: this.apiKey,
      body: {
        model: this.modelId,
        temperature: 0,
        max_tokens: MAX_TOKENS,
        messages: [
          { role: "system", content: entryGoalPrompt },
          { role: "user", content: task },
        ],
      },
      endpoint: this.endpoint,
      label: "Task completion classification",
      schema: textResponseSchema,
      timeoutMs: TIMEOUT_MS,
    });
    return entryGoalSchema.parse(response.choices[0].message.content.trim());
  }

  public async prepare(task: string): Promise<TaskPlan> {
    const body: TextRequest = {
      model: this.modelId,
      temperature: 0,
      max_tokens: MAX_TOKENS,
      messages: [
        { role: "system", content: planPrompt },
        { role: "user", content: task },
      ],
    };
    const response = await requestJson({
      apiKey: this.apiKey,
      body,
      endpoint: this.endpoint,
      label: "Text model",
      schema: textResponseSchema,
      timeoutMs: TIMEOUT_MS,
    });
    const plan = groundedPlan(task, parsePlan(response.choices[0].message.content));
    if (plan.textToEnter !== undefined && plan.goal !== "enter_text") {
      const goal = (await this.entryGoal(task)) === "enter_text" ? "enter_text" : "task";
      return { ...plan, goal, textToEnter: plan.textToEnter };
    }
    return plan;
  }
}

export { ChatCompletionTextModel };
export type { TextModel };
