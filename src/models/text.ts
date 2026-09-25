import type { Observation } from "../agent/contracts.ts";
import { textResponseSchema } from "./text-schema.ts";
import { requestJson } from "./request.ts";
import { summarizeObservation } from "../app/sessions/context.ts";

interface TextInput {
  readonly task: string;
  readonly context: string;
  readonly observation: Observation;
  readonly purpose: "text" | "url" | "application";
  readonly applications?: readonly string[];
  readonly field?: { readonly label: string; readonly value: string };
}
interface TextModel {
  readonly generate: (input: TextInput) => Promise<string>;
}
const TIMEOUT_MS = 60_000;
const MAX_TOKENS = 1024;
const PROMPTS = {
  application:
    "Return only the exact installed application name needed for this tool call, from the supplied applications list. No explanation, quotes, or markdown. This is an argument to an already selected open-application tool, not a task plan.",
  url: "Return only the absolute HTTP or HTTPS URL needed for this task. Use a search-engine URL if no destination is known. No explanation or markdown.",
  text: "Return only the text needed in the specified input field to advance the user's task. Preserve text supplied by the user. No explanation, wrapping quotes or markdown fences. Never generate passwords or authentication credentials. Return an empty string if no appropriate text is available.",
};
class ChatCompletionTextModel implements TextModel {
  private readonly endpoint: string;
  private readonly modelId: string;
  private readonly apiKey: string | undefined;
  public constructor(endpoint: string, modelId: string, apiKey?: string) {
    this.endpoint = endpoint;
    this.modelId = modelId;
    this.apiKey = apiKey;
  }
  public async generate(input: TextInput): Promise<string> {
    const response = await requestJson({
      endpoint: this.endpoint,
      apiKey: this.apiKey,
      label: "Text input",
      schema: textResponseSchema,
      timeoutMs: TIMEOUT_MS,
      body: {
        model: this.modelId,
        temperature: 0,
        max_tokens: MAX_TOKENS,
        messages: [
          {
            role: "system",
            content: PROMPTS[input.purpose],
          },
          {
            role: "user",
            content: JSON.stringify({
              task: input.task,
              context: input.context,
              field: input.field,
              applications: input.applications,
              observed: summarizeObservation(input.observation),
            }),
          },
        ],
      },
    });
    return response.choices[0].message.content;
  }
}
export { ChatCompletionTextModel };
export type { TextModel, TextInput };
