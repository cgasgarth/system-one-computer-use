import { z } from "zod";
import { taskInputSchema } from "./task-schema.ts";

const taskLineSchema = taskInputSchema.extend({ kind: z.literal("task") });
const approvalResponseLineSchema = z.strictObject({
  kind: z.literal("approval_response"),
  // Swift's UUID encoder uses uppercase hex; keep one canonical map key.
  requestId: z.uuid().transform((value) => value.toLowerCase()),
  decision: z.enum(["allow_once", "allow_task", "decline"]),
});
const workerInputSchema = z.discriminatedUnion("kind", [
  taskLineSchema,
  approvalResponseLineSchema,
]);
const approvalEventSchema = z.strictObject({
  status: z.literal("approval_requested"),
  requestId: z.uuid(),
  message: z.string().min(1),
  canAllowTask: z.boolean(),
  app: z.string().min(1).optional(),
  site: z.string().min(1).optional(),
  tool: z.string().min(1).optional(),
});
const approvalMetadataSchema = z
  .object({
    connector_id: z.string().optional(),
    riskLevel: z.string().optional(),
    persist: z.array(z.enum(["session", "always"])).optional(),
    tool_name: z.string().optional(),
    tool_params: z
      .object({
        app: z.string().optional(),
        url: z.url().optional(),
      })
      .loose()
      .optional(),
  })
  .loose();
const approvalFormSchema = z
  .object({
    type: z.literal("object"),
    required: z.array(z.string()).optional(),
    properties: z.record(z.string(), z.unknown()).optional(),
  })
  .loose();

type ApprovalResponseLine = z.infer<typeof approvalResponseLineSchema>;
type ApprovalEvent = z.infer<typeof approvalEventSchema>;
type WorkerInput = z.infer<typeof workerInputSchema>;

export {
  approvalEventSchema,
  approvalFormSchema,
  approvalMetadataSchema,
  approvalResponseLineSchema,
  workerInputSchema,
};
export type { ApprovalEvent, ApprovalResponseLine, WorkerInput };
