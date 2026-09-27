import { DEFAULT_MAX_CHOICES, catalog } from "../../../src/app/models/catalog.ts";
import type { Preset } from "../../../src/app/models/catalog.ts";
import { cases } from "./benchmark-cases.ts";

const TRIALS_PER_CASE = 3;
const MIN_PRESETS = 7;
function decisionPresets(): readonly Preset[] {
  const found = catalog.filter((entry) => entry.role === "decision");
  if (found.length < MIN_PRESETS) {
    throw new Error(`Expected at least ${MIN_PRESETS} decision presets before the full benchmark.`);
  }
  return found;
}
function textPreset(): Preset {
  const found = catalog.find((entry) => entry.id === "qwen-text-2b");
  if (found === undefined) {
    throw new Error("The fixed Qwen text preset is missing.");
  }
  return found;
}
function plan(): object {
  const models = decisionPresets();
  return {
    decisionPresets: models.map((model) => ({
      id: model.id,
      family: model.family,
      maxChoices: model.maxChoices ?? DEFAULT_MAX_CHOICES,
    })),
    textPreset: textPreset().id,
    cases: cases.map((scenario) => scenario.id),
    trialsPerCase: TRIALS_PER_CASE,
    totalTasks: models.length * cases.length * TRIALS_PER_CASE,
    modelOrder: "catalog order; one decision provider at a time",
    modelStartup: "excluded from warm task seconds and recorded separately",
    runGuard: "installed host stopped; blank owned Chrome tab; localhost actions only",
  };
}
export { decisionPresets, plan, textPreset, TRIALS_PER_CASE };
