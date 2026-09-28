import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { z } from "zod";

const CONTROL_SERVERS = new Set(["node_repl", "cua_repl"]);
const CONTROL_PLUGINS = new Set([
  "computer-use@openai-bundled",
  "chrome@openai-bundled",
  "unified-computer-use@openai-bundled",
]);
const MAX_NAME_LENGTH = 256;
const nameSchema = z
  .string()
  .min(1)
  .max(MAX_NAME_LENGTH)
  .regex(/^[A-Za-z0-9_@-]+$/u);
const tableSchema = z.record(nameSchema, z.unknown());
const configSchema = z
  .object({
    mcp_servers: tableSchema.optional(),
    plugins: tableSchema.optional(),
  })
  .loose();

function decodeToml(configText: string): unknown {
  try {
    return Bun.TOML.parse(configText);
  } catch (error) {
    throw new Error("Codex config.toml is invalid. Fix Codex setup before starting controls.", {
      cause: error,
    });
  }
}
function disabledOverrides(configText: string): string[] {
  const parsed = configSchema.safeParse(decodeToml(configText));
  if (!parsed.success) {
    throw new Error("Codex control configuration has invalid server or plugin names.", {
      cause: parsed.error,
    });
  }
  const mcp = Object.keys(parsed.data.mcp_servers ?? {})
    .filter((name) => !CONTROL_SERVERS.has(name))
    .map((name) => `mcp_servers.${name}.enabled=false`);
  const plugins = Object.keys(parsed.data.plugins ?? {})
    .filter((name) => !CONTROL_PLUGINS.has(name))
    .map((name) => `plugins.${name}.enabled=false`);
  return [
    "--config",
    "features.apps=false",
    ...[...mcp, ...plugins].flatMap((override) => ["--config", override]),
  ];
}

async function readConfigText(configPath: string): Promise<string> {
  try {
    return await readFile(configPath, "utf8");
  } catch (error) {
    throw new Error("Codex config.toml is unavailable. Complete Codex setup first.", {
      cause: error,
    });
  }
}
async function controlConfigOverrides(
  configPath = path.join(homedir(), ".codex", "config.toml"),
): Promise<string[]> {
  return disabledOverrides(await readConfigText(configPath));
}

export { controlConfigOverrides, disabledOverrides };
