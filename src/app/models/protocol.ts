import { z } from "zod";
import { preferencesSchema } from "./catalog.ts";

const commandSchema = z.discriminatedUnion("operation", [
  z.strictObject({ operation: z.literal("configure"), preferences: preferencesSchema }),
  z.strictObject({ operation: z.literal("prepare"), requestId: z.uuid() }),
  z.strictObject({ operation: z.literal("release") }),
  z.strictObject({ operation: z.literal("status") }),
  z.strictObject({ operation: z.literal("shutdown") }),
]);
export { commandSchema };
