import { chmod, rename } from "node:fs/promises";
import { defaultPreferences, preferencesSchema } from "./catalog.ts";
import type { ModelPreferences, ModelSelection } from "./catalog.ts";

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
  return "default_model";
}
async function writePreferences(preferences: Readonly<ModelPreferences>): Promise<void> {
  const temporary = `${FILE}.tmp`;
  await Bun.write(temporary, JSON.stringify(preferences));
  await chmod(temporary, PRIVATE_MODE);
  await rename(temporary, FILE);
  const file = Bun.file(".env");
  const original = (await file.exists()) ? await file.text() : "";
  const values = {
    SYSTEM_ONE_URL: "http://127.0.0.1:8700/v1/systemone",
    SYSTEM_ONE_MODEL: modelName(preferences.decision),
    TEXT_MODEL_URL: "http://127.0.0.1:8080/v1/chat/completions",
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
export { modelName, readPreferences, writePreferences };
