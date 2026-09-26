import { z } from "zod";
import { SystemOneHttpDecisionModel } from "../../src/models/system-one.ts";
import { scenarios, validationScenarios } from "./scenarios.ts";

const config = z
  .object({
    SYSTEM_ONE_URL: z.url().default("http://127.0.0.1:8700/v1/systemone"),
    SYSTEM_ONE_MODEL: z.string().default("clm-latest"),
    SYSTEM_ONE_API_KEY: z.string().optional(),
  })
  .parse(Bun.env);
const model = new SystemOneHttpDecisionModel(
  config.SYSTEM_ONE_URL,
  config.SYSTEM_ONE_MODEL,
  config.SYSTEM_ONE_API_KEY,
);
let failures = 0;
for (const scenario of [...scenarios, ...validationScenarios]) {
  // Fixed observations only: this evaluation never executes computer tools.
  // eslint-disable-next-line no-await-in-loop
  const result = await model.choose(scenario.input);
  const passed = (result.action.kind === "finish") === scenario.complete;
  failures += Number(!passed);
  console.log(
    JSON.stringify({
      case: scenario.name,
      passed,
      selected: result.action.reason,
      completion: result.completion?.probabilities["A0"],
      decisionMs: Math.round(result.latencyMs),
    }),
  );
}
console.log(
  `Completion decisions: ${scenarios.length + validationScenarios.length - failures}/${scenarios.length + validationScenarios.length}. This is not an end-to-end task success rate.`,
);
process.exitCode = Number(failures > 0);
