import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { disabledOverrides } from "../src/computer/codex-controls/config-scope.ts";

const fixture = fileURLToPath(new URL("fixtures/codex-controls-config.toml", import.meta.url));
test("scopes an existing Codex config to required control servers and plugins", async () => {
  const args = disabledOverrides(await readFile(fixture, "utf8"));
  expect(args).toEqual([
    "--config",
    "features.apps=false",
    "--config",
    "mcp_servers.playwright.enabled=false",
    "--config",
    "mcp_servers.openaiDeveloperDocs.enabled=false",
    "--config",
    "plugins.messages@openai-bundled.enabled=false",
  ]);
  expect(args.join(" ")).not.toContain("private-test-package");
});
