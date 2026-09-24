import { z } from "zod";
import type { ReadonlyDeep } from "type-fest";

const driverModeSchema = z.enum(["browser", "desktop"]);
const taskTextSchema = z.string().trim().min(1);
const taskInputSchema = z.strictObject({ mode: driverModeSchema, task: taskTextSchema });
const countSchema = z.number().int().nonnegative();
const durationSchema = z.number().nonnegative();
const successSchema = z.object({
  decisions: countSchema,
  requestsPerSecond: durationSchema,
  status: z.literal("complete"),
  summary: z.string(),
  totalSeconds: durationSchema,
});
const errorSchema = z.object({ error: z.string(), status: z.literal("error") });
const taskResponseSchema = z.discriminatedUnion("status", [successSchema, errorSchema]);
type TaskInput = ReadonlyDeep<z.infer<typeof taskInputSchema>>;
type TaskResponse = ReadonlyDeep<z.infer<typeof taskResponseSchema>>;

export { driverModeSchema, taskInputSchema, taskResponseSchema, taskTextSchema };
export type { TaskInput, TaskResponse };
