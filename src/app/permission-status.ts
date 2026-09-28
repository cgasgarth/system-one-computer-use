import { CODEX_CLI, configPath, readCodexSetup } from "./codex-setup.ts";

console.log(
  JSON.stringify(await readCodexSetup({ executable: CODEX_CLI, configuration: configPath })),
);
