import { chmod } from "node:fs/promises";
import { settingsSchema } from "./settings-schema.ts";
import type { Settings } from "./settings-schema.ts";

const PRIVATE_FILE_MODE = 0o600;
const ARGUMENT_OFFSET = 2;
const [operation] = Bun.argv.slice(ARGUMENT_OFFSET);

async function save(settings: Readonly<Settings>): Promise<void> {
  const file = Bun.file(".env");
  const original = (await file.exists()) ? await file.text() : "";
  const values = {
    SYSTEM_ONE_URL: settings.decisionUrl,
    SYSTEM_ONE_MODEL: settings.decisionModel,
    TEXT_MODEL_URL: settings.textUrl,
    TEXT_MODEL_ID: settings.textModel,
  };
  const keys = new Set(Object.keys(values));
  const lines = original.split("\n").filter((line) => !keys.has(line.split("=")[0]?.trim() ?? ""));
  const changed = Object.entries(values).map(([key, value]) => `${key}=${JSON.stringify(value)}`);
  await Bun.write(file, `${lines.join("\n").trimEnd()}\n${changed.join("\n")}\n`);
  await chmod(".env", PRIVATE_FILE_MODE);
}

try {
  if (operation === "save") {
    await save(settingsSchema.parse(JSON.parse(await Bun.stdin.text())));
    console.log(JSON.stringify({ status: "saved" }));
  } else if (operation === "read") {
    console.log(
      JSON.stringify(
        settingsSchema.parse({
          decisionUrl: Bun.env["SYSTEM_ONE_URL"],
          decisionModel: Bun.env["SYSTEM_ONE_MODEL"],
          textUrl: Bun.env["TEXT_MODEL_URL"],
          textModel: Bun.env["TEXT_MODEL_ID"],
        }),
      ),
    );
  } else {
    throw new Error("Use read or save");
  }
} catch (error) {
  console.log(
    JSON.stringify({ error: error instanceof Error ? error.message : "Settings failed" }),
  );
  process.exitCode = 1;
}
