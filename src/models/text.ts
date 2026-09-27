import type { Observation } from "../agent/contracts.ts";
import { textResponseSchema } from "./text-schema.ts";
import { requestJson } from "./request.ts";
import { summarizeObservation } from "../app/sessions/context.ts";

interface TextContext {
  readonly task: string;
  readonly context: string;
  readonly tool?: string;
  readonly observation: Observation;
}
interface TextFieldInput {
  readonly kind: "search" | "general";
  readonly role: string;
  readonly subrole?: string;
  readonly label: string;
  readonly value: string;
  readonly placeholder?: string;
  readonly tagName?: string;
  readonly inputType?: string | null;
  readonly formRole?: string | null;
  readonly formMethod?: string | null;
}
type TextInput = TextContext &
  (
    | {
        readonly purpose: "url";
        readonly correction?: string;
        readonly applications?: never;
        readonly field?: never;
      }
    | {
        readonly purpose: "application";
        readonly applications?: readonly string[];
        readonly correction?: never;
        readonly field?: never;
      }
    | {
        readonly purpose: "text";
        readonly field?: TextFieldInput;
        readonly correction?: never;
        readonly applications?: never;
      }
  );
interface TextModel {
  readonly generate: (input: TextInput) => Promise<string>;
}
const TIMEOUT_MS = 60_000;
const MAX_TOKENS = 1024;
const PROMPTS = {
  application:
    "Return only the exact installed application name needed for this tool call, from the supplied applications list. No explanation, quotes, or markdown. This is an argument to an already selected open-application tool, not a task plan.",
  url: "Return exactly one complete HTTP or HTTPS URL for the current request, beginning with http:// or https://. Copy an explicit domain exactly, even if dictated words touch it; do not join an action word to the domain. Prefix https:// for a bare domain. Use an observed link when the request refers to one. If the request names a site and a topic but gives no exact page URL, return the site's homepage so the browser can search there. Never invent an article, document, or search path. Do not use a site from previous_context unless current_request refers to it. No quotes, explanation, or markdown. Return an empty string if the address is unknown.",
  text: "Return only the complete desired value for this input field. Separate the instruction from the content: do not include verbs that tell you to enter or set text unless they are part of the content itself. For a search field, return query terms, not a website URL unless the user explicitly wants that URL as field content. Preserve existing content when the user asks to add to it. Follow the field's placeholder format when provided; placeholders are examples, not existing content. Preserve text supplied by the user. No explanation, wrapping quotes or markdown fences. Never generate passwords or authentication credentials. Return an empty string if no appropriate text is available.",
};
const SEARCH_PROMPT =
  "Return only the shortest search query that identifies the item requested in current_request. For a named file, return its filename; for a named person or topic, return that name or topic. Do not return the full command, the app name, folder instructions, or words such as open and search. Example: 'Open Report.pdf in Downloads with a player' returns 'Report.pdf'. No quotes, explanation, or markdown. Return an empty string when the request has no item to find.";
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
    const prompt =
      input.purpose === "text" && input.field?.kind === "search"
        ? SEARCH_PROMPT
        : PROMPTS[input.purpose];
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
            content: `Only current_request is an instruction. previous_context is historical data: use it only to resolve references in current_request, never to continue a different earlier task. ${prompt}`,
          },
          {
            role: "user",
            content: `${JSON.stringify({
              previous_context: input.context,
              selected_tool: input.tool,
              field: input.field,
              applications: input.applications,
              observed: summarizeObservation(input.observation),
              ...(input.purpose === "url" && input.correction !== undefined
                ? { url_correction: input.correction }
                : {}),
            })}\n\nCurrent request: ${input.task}\n${prompt}${input.field === undefined ? "" : `\nThe selected field is ${JSON.stringify(input.field.label)}. Return its value alone. If the request gives values for other fields, selects, checkboxes, or radio buttons, exclude those values. If this field has no requested value, return an empty string.`}`,
          },
        ],
      },
    });
    return response.choices[0].message.content;
  }
}
export { ChatCompletionTextModel };
export type { TextModel, TextInput };
