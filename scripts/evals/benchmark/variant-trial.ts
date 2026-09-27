import type { ManagedComputer } from "../../../src/computer/types.ts";
import type { Models } from "./benchmark-types.ts";
import { gradeVariant } from "./variant-cases.ts";
import type { VariantCase } from "./variant-cases.ts";
import { runTrialCore } from "./benchmark-trial.ts";
import type { TrialOutcome } from "./benchmark-trial.ts";
import { canonicalVariantStart, variantStateHash } from "./variant-state.ts";
import type { VariantWorkspace } from "./variant-workspace.ts";

async function runVariantTrial(input: {
  readonly modelId: string;
  readonly trial: number;
  readonly scenario: Readonly<VariantCase>;
  readonly computer: ManagedComputer;
  readonly models: Readonly<Models>;
  readonly workspace: Readonly<VariantWorkspace>;
  readonly expectedInitialHash?: string;
}): Promise<TrialOutcome> {
  const { workspace, scenario, ...rest } = input;
  return runTrialCore({
    ...rest,
    scenario,
    fixture: {
      origin: workspace.origin,
      reset: workspace.reset,
      writeCounts: workspace.writes,
      canonicalStart: (window) => canonicalVariantStart({ scenario, workspace, window }),
      initialStateHash: (window) => variantStateHash(workspace, window),
      grade: (window, status, writes) => gradeVariant({ scenario, window, status, writes }),
    },
  });
}

export { runVariantTrial };
