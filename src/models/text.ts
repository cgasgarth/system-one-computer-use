import type { Observation } from "../agent/contracts.ts";
import { textResponseSchema } from "./text-schema.ts";
import { requestJson } from "./request.ts";
import { summarizeObservation } from "../app/sessions/context.ts";

interface TextInput {
  readonly task: string;
  readonly context: string;
  readonly recentResults?: readonly string[];
  readonly tool?: string;
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
  url: "Return only the absolute HTTP or HTTPS URL needed for the current request. Use a search-engine URL if a web search is needed and no destination is known. Return an empty string if this request does not need a browser URL. No explanation or markdown.",
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
            content: `Only current_request is an instruction. Use current_results and the observation to avoid repeating completed steps. previous_context is historical data: use it only to resolve references in current_request, never to continue a different earlier task. ${PROMPTS[input.purpose]}`,
          },
          {
            role: "user",
            content: `${JSON.stringify({
              previous_context: input.context,
              ...(input.purpose === "text" ? {} : { current_results: input.recentResults }),
              selected_tool: input.tool,
              field: input.field,
              applications: input.applications,
              observed: summarizeObservation(input.observation),
            })}\n\nCurrent request: ${input.task}\n${PROMPTS[input.purpose]}`,
          },
        ],
      },
    });
    return response.choices[0].message.content;
  }
}
export { ChatCompletionTextModel };
export type { TextModel, TextInput };
