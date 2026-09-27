import { chmod, rename } from "node:fs/promises";
import { DEFAULT_MAX_CHOICES, defaultPreferences, preferencesSchema, preset } from "./catalog.ts";
import type { ModelPreferences, ModelSelection } from "./catalog.ts";
import { localModelEndpoint } from "./sockets.ts";
import type { SocketPaths } from "./sockets.ts";

const PRIVATE_MODE = 0o600;
const FILE = "models.json";
async function readPreferences(): Promise<ModelPreferences> {
  const file = Bun.file(FILE);
  return (await file.exists()) ? preferencesSchema.parse(await file.json()) : defaultPreferences;
}
function modelName(selection: ModelSelection): string {
  if (selection.source === "endpoint") {
    return selection.model;
  }
  if (selection.id.startsWith("clm-")) {
    return "clm-latest";
  }
  if (selection.id.startsWith("kev-")) {
    return "kev-latest";
  }
  if (selection.id === "julia-1") {
    return "julia-latest";
  }
  return "default_model";
}
function maxChoices(selection: ModelSelection): number {
  return selection.source === "local"
    ? (preset(selection.id).maxChoices ?? DEFAULT_MAX_CHOICES)
    : DEFAULT_MAX_CHOICES;
}
async function writePreferences(
  preferences: Readonly<ModelPreferences>,
  sockets: SocketPaths,
): Promise<void> {
  const temporary = `${FILE}.tmp`;
  await Bun.write(temporary, JSON.stringify(preferences));
  await chmod(temporary, PRIVATE_MODE);
  await rename(temporary, FILE);
  const file = Bun.file(".env");
  const original = (await file.exists()) ? await file.text() : "";
  const values = {
    SYSTEM_ONE_URL: localModelEndpoint(sockets.ingress, "decision"),
    SYSTEM_ONE_MODEL: modelName(preferences.decision),
    SYSTEM_ONE_MAX_CHOICES: String(maxChoices(preferences.decision)),
    TEXT_MODEL_URL: localModelEndpoint(sockets.ingress, "text"),
    TEXT_MODEL_ID: modelName(preferences.text),
  };
  const keys = new Set(Object.keys(values));
  const lines = original.split("\n").filter((line) => !keys.has(line.split("=")[0]?.trim() ?? ""));
  await Bun.write(
    file,
    `${lines.join("\n").trimEnd()}\n${Object.entries(values)
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join("\n")}\n`,
  );
  await chmod(".env", PRIVATE_MODE);
}
export { maxChoices, modelName, readPreferences, writePreferences };
