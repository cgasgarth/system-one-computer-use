import { selectionSchema } from "./sessions/schema.ts";
import { z } from "zod";
import type { ReadonlyDeep } from "type-fest";

const driverModeSchema = z.enum(["auto", "browser", "desktop"]);
const taskTextSchema = z.string().trim().min(1);
const taskInputSchema = z.strictObject({
  mode: driverModeSchema,
  task: taskTextSchema,
  session: selectionSchema.default({ mode: "auto" }),
  submittedAt: z.number().int().nonnegative().optional(),
});
type TaskInput = ReadonlyDeep<z.infer<typeof taskInputSchema>>;

export { driverModeSchema, taskInputSchema, taskTextSchema };
export type { TaskInput };
