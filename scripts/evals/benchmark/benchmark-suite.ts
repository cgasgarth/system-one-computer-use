import { startWorkspace } from "../workspace.ts";
import type { BenchmarkCase } from "./benchmark-cases.ts";
import { standardExecutions, variantExecutions } from "./benchmark-execution.ts";
import type { ScenarioExecution } from "./benchmark-execution.ts";
import { variantCases } from "./variant-cases.ts";
import { startVariantWorkspace } from "./variant-workspace.ts";

interface BenchmarkSuite {
  readonly origin: string;
  readonly close: () => Promise<void>;
  readonly executions: readonly ScenarioExecution[];
  readonly variantMetadata?: {
    readonly configSha256: string;
    readonly tasks: readonly { readonly id: string; readonly task: string }[];
  };
}

async function createBenchmarkSuite(
  scenarios: readonly BenchmarkCase[],
  variantFile = Bun.env["BENCHMARK_VARIANT_FILE"],
): Promise<BenchmarkSuite> {
  if (variantFile === undefined) {
    const workspace = startWorkspace();
    return {
      origin: workspace.origin,
      close: workspace.close,
      executions: standardExecutions(workspace, scenarios),
    };
  }
  const json = await Bun.file(variantFile).text();
  const workspace = startVariantWorkspace(JSON.parse(json));
  return {
    origin: workspace.origin,
    close: workspace.close,
    executions: variantExecutions(
      workspace,
      scenarios.map((scenario) => scenario.id),
    ),
    variantMetadata: {
      configSha256: new Bun.CryptoHasher("sha256").update(json).digest("hex"),
      tasks: variantCases(workspace).map((scenario) => ({ id: scenario.id, task: scenario.task })),
    },
  };
}

export { createBenchmarkSuite };
