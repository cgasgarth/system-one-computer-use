import { DEFAULT_MAX_CHOICES, catalog } from "../../../src/app/models/catalog.ts";
import type { Preset } from "../../../src/app/models/catalog.ts";
import { cases } from "./benchmark-cases.ts";
import type { BenchmarkCase } from "./benchmark-cases.ts";

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
function selectedPresets(ids: readonly string[] | undefined): readonly Preset[] {
  const all = decisionPresets();
  if (ids === undefined) {
    return all;
  }
  const selected = all.filter((model) => ids.includes(model.id));
  if (selected.length !== ids.length || selected.length === 0) {
    throw new Error("The benchmark model filter must name distinct supported decision presets.");
  }
  return selected;
}
function selectedCases(ids: readonly string[] | undefined): readonly BenchmarkCase[] {
  if (ids === undefined) {
    return cases;
  }
  const selected = cases.filter((scenario) => ids.includes(scenario.id));
  if (selected.length !== ids.length || selected.length === 0) {
    throw new Error("The benchmark case filter must name distinct disposable cases.");
  }
  return selected;
}
function selectionFromEnvironment(): {
  readonly models: readonly Preset[];
  readonly scenarios: readonly BenchmarkCase[];
} {
  const modelIds = Bun.env["BENCHMARK_MODELS"]?.split(",").map((value) => value.trim());
  const caseIds = Bun.env["BENCHMARK_CASES"]?.split(",").map((value) => value.trim());
  return { models: selectedPresets(modelIds), scenarios: selectedCases(caseIds) };
}
function plan(
  input: {
    readonly models?: readonly Preset[];
    readonly scenarios?: readonly BenchmarkCase[];
  } = {},
): object {
  const models = input.models ?? decisionPresets();
  const scenarios = input.scenarios ?? cases;
  return {
    decisionPresets: models.map((model) => ({
      id: model.id,
      family: model.family,
      maxChoices: model.maxChoices ?? DEFAULT_MAX_CHOICES,
    })),
    textPreset: textPreset().id,
    cases: scenarios.map((scenario) => scenario.id),
    trialsPerCase: TRIALS_PER_CASE,
    totalTasks: models.length * scenarios.length * TRIALS_PER_CASE,
    modelOrder: "catalog order; one decision provider at a time",
    modelStartup: "excluded from warm task seconds and recorded separately",
    runGuard: "installed host stopped; private isolated Chrome context; localhost actions only",
  };
}
export {
  decisionPresets,
  plan,
  selectedCases,
  selectedPresets,
  selectionFromEnvironment,
  textPreset,
  TRIALS_PER_CASE,
};
