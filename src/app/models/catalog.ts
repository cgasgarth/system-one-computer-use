import { z } from "zod";

const modelIdSchema = z.enum([
  "clm-8b-q4",
  "clm-8b-q8",
  "clm-8b-bf16",
  "kev-0.8b",
  "kev-4b",
  "kev-9b",
  "qwen-text-2b",
]);
const roleSchema = z.enum(["decision", "text"]);
const retentionSchema = z.enum(["warm", "five_minutes", "cold"]);
const selectionSchema = z.discriminatedUnion("source", [
  z.strictObject({ source: z.literal("local"), id: modelIdSchema }),
  z.strictObject({
    source: z.literal("endpoint"),
    url: z.url({ protocol: /^https?$/u, error: "Enter a valid HTTP or HTTPS inference URL." }),
    model: z.string().trim().min(1, "Enter a model ID."),
  }),
]);
const preferencesSchema = z.strictObject({
  decision: selectionSchema.refine(
    (selection) => selection.source === "endpoint" || selection.id !== "qwen-text-2b",
    "Choose a decision model",
  ),
  text: selectionSchema.refine(
    (selection) => selection.source === "endpoint" || selection.id === "qwen-text-2b",
    "Choose a text generation model",
  ),
  retention: retentionSchema,
});
interface Preset {
  readonly id: z.infer<typeof modelIdSchema>;
  readonly name: string;
  readonly role: z.infer<typeof roleSchema>;
  readonly description: string;
  readonly family: "clm" | "kev" | "text";
  readonly hub: string;
  readonly bits: number;
}
const catalog: readonly Preset[] = [
  {
    id: "clm-8b-q4",
    name: "CLM 8B · 4-bit",
    role: "decision",
    family: "clm",
    hub: "Contrastive-LM/CLM-v0.1-8B",
    bits: 4,
    description: "Default · lower memory",
  },
  {
    id: "clm-8b-q8",
    name: "CLM 8B · 8-bit",
    role: "decision",
    family: "clm",
    hub: "Contrastive-LM/CLM-v0.1-8B",
    bits: 8,
    description: "Higher precision",
  },
  {
    id: "clm-8b-bf16",
    name: "CLM 8B · BF16",
    role: "decision",
    family: "clm",
    hub: "Contrastive-LM/CLM-v0.1-8B",
    bits: 0,
    description: "Full precision · more memory",
  },
  {
    id: "kev-0.8b",
    name: "Kev 0.8B",
    role: "decision",
    family: "kev",
    hub: "jaredpalmer/kev-0.8b",
    bits: 0,
    description: "Smallest Kev · MLX",
  },
  {
    id: "kev-4b",
    name: "Kev 4B",
    role: "decision",
    family: "kev",
    hub: "jaredpalmer/kev-4b",
    bits: 0,
    description: "Balanced Kev · MLX",
  },
  {
    id: "kev-9b",
    name: "Kev 9B",
    role: "decision",
    family: "kev",
    hub: "jaredpalmer/kev-9b",
    bits: 0,
    description: "Largest preset · MLX",
  },
  {
    id: "qwen-text-2b",
    name: "Qwen 3.5 2B · 4-bit",
    role: "text",
    family: "text",
    hub: "mlx-community/Qwen3.5-2B-4bit",
    bits: 4,
    description: "Local text writer",
  },
];
const defaultPreferences: z.infer<typeof preferencesSchema> = {
  decision: { source: "local", id: "clm-8b-q4" },
  text: { source: "local", id: "qwen-text-2b" },
  retention: "five_minutes",
};
function preset(id: z.infer<typeof modelIdSchema>): Preset {
  const found = catalog.find((entry) => entry.id === id);
  if (found === undefined) {
    throw new Error("Unknown model preset");
  }
  return found;
}
type ModelRole = z.infer<typeof roleSchema>;
type ModelSelection = z.infer<typeof selectionSchema>;
type ModelPreferences = z.infer<typeof preferencesSchema>;

export {
  catalog,
  defaultPreferences,
  modelIdSchema,
  preferencesSchema,
  preset,
  retentionSchema,
  roleSchema,
  selectionSchema,
};
export type { Preset, ModelRole, ModelSelection, ModelPreferences };
