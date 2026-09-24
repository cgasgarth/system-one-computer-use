import type { ReadonlyDeep } from "type-fest";
import { z } from "zod";
import { CuaBrowserComputer } from "../computer/browser-adapter.ts";
import { CuaMcpComputer } from "../computer/native.ts";
import type { ManagedComputer } from "../computer/types.ts";
import { SystemOneHttpDecisionModel } from "../models/system-one.ts";
import type { DecisionModel } from "../models/system-one.ts";
import { ChatCompletionTextModel } from "../models/text.ts";
import type { TextModel } from "../models/text.ts";
import { driverModeSchema } from "./task-schema.ts";

const DEFAULT_PORT = 8787;
const MAX_PORT = 65_535;
const DEFAULT_STEPS = 16;
const endpointSchema = z.url({ protocol: /^https?$/u });
const optionalKey = z.string().min(1).optional();
const stepsSchema = z.coerce.number().int().positive().default(DEFAULT_STEPS);
const portSchema = z.coerce.number().int().positive().max(MAX_PORT).default(DEFAULT_PORT);
const configSchema = z.object({
  CUA_BROWSER_APP: z.string().default("Google Chrome"),
  CUA_DRIVER_BIN: z.string().default("cua-driver"),
  CUA_MODE: driverModeSchema.default("browser"),
  PORT: portSchema,
  SYSTEM_ONE_API_KEY: optionalKey,
  SYSTEM_ONE_MAX_STEPS: stepsSchema,
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

function createComputer(config: Config, mode: DriverMode): ManagedComputer {
  if (mode === "browser") {
    return new CuaBrowserComputer(config.CUA_BROWSER_APP, config.CUA_DRIVER_BIN);
  }
  return new CuaMcpComputer(config.CUA_DRIVER_BIN);
}

export { createComputer, createModels, loadConfig };
export type { Config, DriverMode };
