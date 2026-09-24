import { z } from "zod";
import { taskPlanSchema } from "../agent/contracts.ts";
import type { TaskPlan } from "../agent/contracts.ts";
import { requestJson } from "./request.ts";
import { textResponseSchema } from "./text-schema.ts";
import type { TextRequest } from "./text-schema.ts";
import { computerModeSchema } from "../computer/types.ts";
import type { ComputerMode } from "../computer/types.ts";
import { PlanValidationError } from "./errors.ts";

interface TextModel {
  readonly prepare: (task: string) => Promise<TaskPlan>;
  readonly route: (task: string) => Promise<ComputerMode>;
}

const TIMEOUT_MS = 15_000;
const MAX_TOKENS = 256;
const ERROR_DETAIL_LIMIT = 350;
const FENCE_LENGTH = 3;
const entryGoalSchema = z.enum(["open_url", "open_app", "enter_text", "task"]);
const entryGoalPrompt = `Classify the task. Reply with one word: open_url, open_app, enter_text, or task. Choose enter_text when the user asks to type into a field, including after navigation.`;
const planPrompt = `Convert the request to one complete JSON task plan. Return JSON only.
Required goal: open_app, open_url, enter_text, or task.
For open_app, app is REQUIRED. For open_url, url is REQUIRED. For enter_text, textToEnter is REQUIRED.
Optional fields: app, url, textToEnter, targetLabel. Omit unused fields.
Use open_app when opening an app completes the request. Possessives such as "my calendar" refer to the Calendar application.
Use open_url when visiting a URL completes the request. Use enter_text when the request ends with entering supplied text, even after navigation.
Use task for other workflows, including submission after typing.
Copy URLs and requested text exactly. App names can use normal capitalization. Do not invent a URL, text, or app.
Examples:
"open my calendar" -> {"goal":"open_app","app":"Calendar"}
"open my notes" -> {"goal":"open_app","app":"Notes"}
"visit https://example.com" -> {"goal":"open_url","url":"https://example.com"}
"Open https://example.com and click Learn more" -> {"goal":"task","url":"https://example.com","targetLabel":"Learn more"}
"Type hello into Message" -> {"goal":"enter_text","textToEnter":"hello","targetLabel":"Message"}
Return the full object, never just goal.`;

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
    const reason = error instanceof Error ? error.message : "Invalid JSON";
    throw new PlanValidationError(
      `${reason}\nPrevious output: ${content.slice(0, ERROR_DETAIL_LIMIT)}`,
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

  private async requestPlan(task: string, correction?: string): Promise<TaskPlan> {
    const body: TextRequest = {
      model: this.modelId,
      temperature: 0,
      max_tokens: MAX_TOKENS,
      messages: [
        {
          role: "system",
          content:
            correction === undefined
              ? planPrompt
              : `${planPrompt}\nRepair the previous invalid result. Validation error: ${correction}`,
        },
        { role: "user", content: `Task: ${JSON.stringify(task)}\nComplete JSON plan:` },
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
    return groundedPlan(task, parsePlan(response.choices[0].message.content));
  }

  private async validatedPlan(task: string): Promise<TaskPlan> {
    try {
      return await this.requestPlan(task);
    } catch (error) {
      if (!(error instanceof PlanValidationError)) {
        throw error;
      }
      return this.requestPlan(task, error.detail);
    }
  }

  public async prepare(task: string): Promise<TaskPlan> {
    const plan = await this.validatedPlan(task);
    if (plan.textToEnter !== undefined && plan.goal !== "enter_text") {
      const goal = (await this.entryGoal(task)) === "enter_text" ? "enter_text" : "task";
      return { ...plan, goal, textToEnter: plan.textToEnter };
    }
    return plan;
  }
}

export { ChatCompletionTextModel };
export type { TextModel };
