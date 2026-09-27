import { z } from "zod";
import { decisionRequestSchema, decisionResponseSchema } from "../system-one-schema.ts";
import { textRequestSchema, textResponseSchema } from "../text-schema.ts";

const MAX_FRAME_BYTES = 4_194_304;
const inferenceRoleSchema = z.enum(["decision", "text"]);
const inferenceRequestSchema = z.discriminatedUnion("role", [
  z.strictObject({ role: z.literal("decision"), body: decisionRequestSchema }),
  z.strictObject({ role: z.literal("text"), body: textRequestSchema }),
]);
const inferenceResponseSchema = z.discriminatedUnion("ok", [
  z.strictObject({
    ok: z.literal(true),
    body: z.union([decisionResponseSchema, textResponseSchema]),
  }),
  z.strictObject({ ok: z.literal(false), error: z.string() }),
]);
type InferenceRequest = z.infer<typeof inferenceRequestSchema>;
type InferenceResponse = z.infer<typeof inferenceResponseSchema>;
type InferenceRole = z.infer<typeof inferenceRoleSchema>;

export { MAX_FRAME_BYTES, inferenceRequestSchema, inferenceResponseSchema, inferenceRoleSchema };
export type { InferenceRequest, InferenceResponse, InferenceRole };
