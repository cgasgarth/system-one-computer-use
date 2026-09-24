import { z } from "zod";

const endpoint = z.url({ protocol: /^https?$/u });
const MAX_MODEL_ID = 200;
const model = z
  .string()
  .trim()
  .min(1)
  .max(MAX_MODEL_ID)
  .regex(/^[^\r\n]+$/u);
const settingsSchema = z.strictObject({
  decisionUrl: endpoint,
  decisionModel: model,
  textUrl: endpoint,
  textModel: model,
});
type Settings = z.infer<typeof settingsSchema>;

export { settingsSchema };
export type { Settings };
