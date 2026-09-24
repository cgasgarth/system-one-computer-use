import type { ReadonlyDeep } from "type-fest";
import { z } from "zod";

const actionIdSchema = z.string().regex(/^A[0-9]+$/u);
const probabilitySchema = z.number().min(0).max(1);
const probabilitiesSchema = z.record(actionIdSchema, probabilitySchema);
const criteriaSchema = z.record(actionIdSchema, z.string());
const answerSchema = z.object({ choice: actionIdSchema, probabilities: probabilitiesSchema });
const answersSchema = z.object({ next_action: answerSchema });
const decisionResponseSchema = z.object({ answers: answersSchema });
const questionSchema = z.object({
  criteria: criteriaSchema,
  instructions: z.string(),
  type: z.literal("choice"),
});
const questionsSchema = z.object({ next_action: questionSchema });
const decisionRequestSchema = z.object({
  model: z.string(),
  questions: questionsSchema,
  state: z.string(),
});

type ActionCriteria = z.infer<typeof criteriaSchema>;
type ActionProbabilities = ReadonlyDeep<z.infer<typeof probabilitiesSchema>>;
type DecisionAnswer = ReadonlyDeep<z.infer<typeof answerSchema>>;
type DecisionRequest = ReadonlyDeep<z.infer<typeof decisionRequestSchema>>;

export { decisionRequestSchema, decisionResponseSchema };
export type { ActionCriteria, ActionProbabilities, DecisionAnswer, DecisionRequest };
