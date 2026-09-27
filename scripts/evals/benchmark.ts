import { plan } from "./benchmark/benchmark-plan.ts";
import { runBenchmark } from "./benchmark/benchmark-run.ts";

const CLI_ARGUMENT_OFFSET = 2;
const [mode] = Bun.argv.slice(CLI_ARGUMENT_OFFSET);
if (mode === "plan") {
  console.log(JSON.stringify(plan()));
} else if (mode === "run") {
  await runBenchmark();
} else {
  throw new Error("Use `bun scripts/evals/benchmark.ts plan` or `... run`.");
}
