import type { ReadonlyDeep } from "type-fest";
import { z } from "zod";
import { PlaywrightComputer } from "../computer/playwright/computer.ts";
import { CuaMcpComputer } from "../computer/native.ts";
import type { ComputerMode, ManagedComputer } from "../computer/types.ts";
import { SystemOneHttpDecisionModel } from "../models/system-one.ts";
import type { DecisionModel } from "../models/system-one.ts";
import { ChatCompletionTextModel } from "../models/text.ts";
import type { TextModel } from "../models/text.ts";
import { driverModeSchema } from "./task-schema.ts";

const endpointSchema = z.url({ protocol: /^https?$/u });
const optionalKey = z.string().min(1).optional();
const configSchema = z.object({
  CUA_DRIVER_BIN: z.string().default("cua-driver"),
  CUA_MODE: driverModeSchema.default("auto"),
  PLAYWRIGHT_MCP_EXTENSION_TOKEN: optionalKey,
  SYSTEM_ONE_API_KEY: optionalKey,
  SYSTEM_ONE_MODEL: z.string().min(1),
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
    decision: new SystemOneHttpDecisionModel(
      config.SYSTEM_ONE_URL,
      config.SYSTEM_ONE_MODEL,
      config.SYSTEM_ONE_API_KEY,
    ),
    text: new ChatCompletionTextModel(
      config.TEXT_MODEL_URL,
      config.TEXT_MODEL_ID,
      config.TEXT_MODEL_API_KEY,
    ),
  };
}

function createComputer(config: Config, mode: ComputerMode): ManagedComputer {
  if (mode === "browser") {
    return new PlaywrightComputer(config.PLAYWRIGHT_MCP_EXTENSION_TOKEN);
  }
  return new CuaMcpComputer(config.CUA_DRIVER_BIN);
}

export { createComputer, createModels, loadConfig };
export { installedApplications } from "../computer/applications.ts";
export type { Config, DriverMode };
