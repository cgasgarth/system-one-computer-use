import type { ManagedComputer } from "../../../src/computer/types.ts";
import type { BenchmarkCase } from "./benchmark-cases.ts";
import { runTrial } from "./benchmark-trial.ts";
import type { TrialOutcome } from "./benchmark-trial.ts";
import type { Models } from "./benchmark-types.ts";
import { variantCases } from "./variant-cases.ts";
import { runVariantTrial } from "./variant-trial.ts";
import type { VariantWorkspace } from "./variant-workspace.ts";
import type { Workspace } from "../workspace.ts";

interface ExecutionInput {
  readonly modelId: string;
  readonly trial: number;
  readonly computer: ManagedComputer;
  readonly models: Readonly<Models>;
  readonly expectedInitialHash?: string;
}
interface ScenarioExecution {
  readonly id: string;
  readonly run: (input: Readonly<ExecutionInput>) => Promise<TrialOutcome>;
}

function standardExecutions(
  workspace: Readonly<Workspace>,
  scenarios: readonly BenchmarkCase[],
): readonly ScenarioExecution[] {
  return scenarios.map((scenario) => ({
    id: scenario.id,
    run: async (input) => runTrial({ ...input, scenario, workspace }),
  }));
}

function variantExecutions(
  workspace: Readonly<VariantWorkspace>,
  selectedIds: readonly string[],
): readonly ScenarioExecution[] {
  return variantCases(workspace)
    .filter((scenario) => selectedIds.includes(scenario.id))
    .map((scenario) => ({
      id: scenario.id,
      run: async (input) => runVariantTrial({ ...input, scenario, workspace }),
    }));
}

export { standardExecutions, variantExecutions };
export type { ScenarioExecution };
