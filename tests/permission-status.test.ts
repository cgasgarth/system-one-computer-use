import { afterEach, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { readCodexSetup } from "../src/app/codex-setup.ts";

const executableMode = 0o700;
const directories: string[] = [];

async function fixture(
  configuration: string,
  runtime: boolean,
): Promise<{
  executable: string;
  configuration: string;
}> {
  const directory = await mkdtemp(path.resolve("runs/codex-setup-test-"));
  directories.push(directory);
  const executable = path.join(directory, "codex");
  const configFile = path.join(directory, "config.toml");
  if (runtime) {
    await writeFile(executable, "#!/bin/sh\nexit 0\n");
    await chmod(executable, executableMode);
  }
  await writeFile(configFile, configuration);
  return { executable, configuration: configFile };
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map(async (directory) => rm(directory, { recursive: true, force: true })),
  );
});

test("reports installed runtime and enabled Codex control plugins without claiming a grant", async () => {
  const paths = await fixture(
    `
[plugins."computer-use@openai-bundled"]
enabled = true
[plugins."chrome@openai-bundled"]
enabled = true
`,
    true,
  );
  expect(await readCodexSetup(paths)).toEqual({
    runtimeInstalled: true,
    computerUseEnabled: true,
    chromeEnabled: true,
  });
});

test("separates missing runtime, disabled plugin, and unreadable config", async () => {
  const disabled = await fixture(
    `
[plugins."computer-use@openai-bundled"]
enabled = false
`,
    false,
  );
  expect(await readCodexSetup(disabled)).toEqual({
    runtimeInstalled: false,
    computerUseEnabled: false,
    chromeEnabled: false,
  });
  const invalid = await fixture("[plugins\n", true);
  expect(await readCodexSetup(invalid)).toEqual({
    runtimeInstalled: true,
  });
});
