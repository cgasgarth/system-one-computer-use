import type { ReadonlyDeep } from "type-fest";
import { z } from "zod";
import { CodexChromeComputer } from "../computer/codex-chrome/computer.ts";
import { CodexNativeComputer } from "../computer/codex-controls/native-computer.ts";
import type { CodexComputerOptions } from "../computer/codex-controls/protocol.ts";
import type { ComputerMode, ManagedComputer } from "../computer/types.ts";
import { SystemOneDecisionModel } from "../models/system-one.ts";
import type { DecisionModel } from "../models/system-one.ts";
import { ChatCompletionTextModel } from "../models/text.ts";
import type { TextModel } from "../models/text.ts";
import { driverModeSchema } from "./task-schema.ts";
import { endpointSchema } from "../models/transport/endpoint.ts";

const MIN_MODEL_CHOICES = 2;
const MAX_MODEL_CHOICES = 255;
const optionalKey = z.string().min(1).optional();
const configSchema = z.object({
  SYSTEM_ONE_CONTROL_SURFACE: driverModeSchema.default("auto"),
  SYSTEM_ONE_API_KEY: optionalKey,
  SYSTEM_ONE_MODEL: z.string().min(1),
  SYSTEM_ONE_MAX_CHOICES: z.coerce
    .number()
    .int()
    .min(MIN_MODEL_CHOICES)
    .max(MAX_MODEL_CHOICES)
    .default(MAX_MODEL_CHOICES),
  SYSTEM_ONE_TRACE: z.enum(["0", "1"]).default("0"),
  SYSTEM_ONE_URL: endpointSchema,
  TEXT_MODEL_API_KEY: optionalKey,
  TEXT_MODEL_ID: z.string().min(1),
  TEXT_MODEL_URL: endpointSchema,
});
type Config = ReadonlyDeep<z.infer<typeof configSchema>>;
type DriverMode = z.infer<typeof driverModeSchema>;
interface Models {
  readonly decision: DecisionModel;
  readonly text: TextModel;
}
function loadConfig(): Config {
  return configSchema.parse(Bun.env);
}

function createModels(config: Config): Models {
  return {
    decision: new SystemOneDecisionModel(config.SYSTEM_ONE_URL, config.SYSTEM_ONE_MODEL, {
      apiKey: config.SYSTEM_ONE_API_KEY,
      maxChoices: config.SYSTEM_ONE_MAX_CHOICES,
    }),
    text: new ChatCompletionTextModel(
      config.TEXT_MODEL_URL,
      config.TEXT_MODEL_ID,
      config.TEXT_MODEL_API_KEY,
    ),
  };
}

// oxlint-disable-next-line typescript/prefer-readonly-parameter-types -- AbortSignal is the shared cancellation contract.
function createComputer(mode: ComputerMode, options: CodexComputerOptions): ManagedComputer {
  return mode === "browser" ? new CodexChromeComputer(options) : new CodexNativeComputer(options);
}

export { createComputer, createModels, loadConfig };
export { installedApplications } from "../computer/applications.ts";
export type { Config, DriverMode };
