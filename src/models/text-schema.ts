import type { ReadonlyDeep } from "type-fest";
import { z } from "zod";

const responseMessageSchema = z.object({ content: z.string() });
const choiceSchema = z.object({
  message: responseMessageSchema,
  finish_reason: z.literal("stop", {
    error: "Text model response was incomplete. No text was entered.",
  }),
});
const usageSchema = z.object({
  prompt_tokens: z.number().int().nonnegative().optional(),
  prompt_tokens_details: z
    .object({ cached_tokens: z.number().int().nonnegative().optional() })
    .optional(),
});
const choicesSchema = z.tuple([choiceSchema]).rest(choiceSchema);
const textResponseSchema = z.object({
  choices: choicesSchema,
  usage: usageSchema.nullable().optional(),
});
const prefillChoiceSchema = choiceSchema.extend({ finish_reason: z.enum(["stop", "length"]) });
const textPrefillResponseSchema = z.object({
  choices: z.tuple([prefillChoiceSchema]).rest(prefillChoiceSchema),
  usage: usageSchema.extend({
    prompt_tokens: z.number().int().nonnegative(),
    prompt_tokens_details: z.object({ cached_tokens: z.number().int().nonnegative() }),
  }),
});
const messageSchema = z.object({ content: z.string(), role: z.enum(["system", "user"]) });
const messagesSchema = z.array(messageSchema);
const textRequestSchema = z.object({
  max_tokens: z.number().int().positive(),
  messages: messagesSchema,
  model: z.string(),
  temperature: z.number(),
});
type TextRequest = ReadonlyDeep<z.infer<typeof textRequestSchema>>;
type TextResponse = ReadonlyDeep<z.infer<typeof textResponseSchema>>;

export { textPrefillResponseSchema, textRequestSchema, textResponseSchema };
export type { TextRequest, TextResponse };
