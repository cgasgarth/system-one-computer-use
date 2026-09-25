import type { ReadonlyDeep } from "type-fest";
import { z } from "zod";

const responseMessageSchema = z.object({ content: z.string() });
const choiceSchema = z.object({
  message: responseMessageSchema,
  finish_reason: z.literal("stop", {
    error: "Text model response was incomplete. No text was entered.",
  }),
});
const choicesSchema = z.tuple([choiceSchema]).rest(choiceSchema);
const textResponseSchema = z.object({ choices: choicesSchema });
const messageSchema = z.object({ content: z.string(), role: z.enum(["system", "user"]) });
const messagesSchema = z.array(messageSchema);
const textRequestSchema = z.object({
  max_tokens: z.number().int().positive(),
  messages: messagesSchema,
  model: z.string(),
  temperature: z.number(),
});
type TextRequest = ReadonlyDeep<z.infer<typeof textRequestSchema>>;

export { textRequestSchema, textResponseSchema };
export type { TextRequest };
