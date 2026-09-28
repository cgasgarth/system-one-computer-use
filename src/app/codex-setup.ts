import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import os from "node:os";
import { z } from "zod";

const CODEX_CLI =
  "/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex";
const configPath = path.join(os.homedir(), ".codex", "config.toml");
const pluginSchema = z.object({ enabled: z.boolean().optional() }).loose();
const configSchema = z
  .object({
    plugins: z.record(z.string(), pluginSchema).optional(),
  })
  .loose();
const setupSchema = z.strictObject({
  runtimeInstalled: z.boolean(),
  computerUseEnabled: z.boolean().optional(),
  chromeEnabled: z.boolean().optional(),
});
type CodexSetup = z.infer<typeof setupSchema>;
interface SetupPaths {
  readonly executable: string;
  readonly configuration: string;
}

async function executable(pathname: string): Promise<boolean> {
  try {
    await access(pathname, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function readCodexSetup(paths: Readonly<SetupPaths>): Promise<CodexSetup> {
  const runtimeInstalled = await executable(paths.executable);
  try {
    const parsed = configSchema.parse(Bun.TOML.parse(await readFile(paths.configuration, "utf8")));
    return setupSchema.parse({
      runtimeInstalled,
      computerUseEnabled: parsed.plugins?.["computer-use@openai-bundled"]?.enabled === true,
      chromeEnabled: parsed.plugins?.["chrome@openai-bundled"]?.enabled === true,
    });
  } catch {
    return { runtimeInstalled };
  }
}

export { CODEX_CLI, configPath, readCodexSetup, setupSchema };
export type { CodexSetup, SetupPaths };
