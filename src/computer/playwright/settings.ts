import os from "node:os";
import path from "node:path";
import { z } from "zod";

const tokenSchema = z.string().min(1);
const claudeConfigSchema = z.object({
  mcpServers: z.object({
    playwright: z.object({
      env: z.object({ PLAYWRIGHT_MCP_EXTENSION_TOKEN: tokenSchema }),
    }),
  }),
});

async function extensionToken(configured: string | undefined): Promise<string> {
  if (configured !== undefined) {
    return tokenSchema.parse(configured);
  }
  const file = Bun.file(path.join(os.homedir(), ".claude.json"));
  if (await file.exists()) {
    const config = claudeConfigSchema.safeParse(await file.json());
    if (config.success) {
      return config.data.mcpServers.playwright.env.PLAYWRIGHT_MCP_EXTENSION_TOKEN;
    }
  }
  throw new Error(
    "Set PLAYWRIGHT_MCP_EXTENSION_TOKEN from the Chrome extension, or configure Playwright in ~/.claude.json.",
  );
}

async function chromeExecutable(): Promise<string | undefined> {
  const configured = Bun.env["PLAYWRIGHT_MCP_EXECUTABLE_PATH"];
  if (configured !== undefined) {
    return z.string().min(1).parse(configured);
  }
  if (process.platform !== "darwin") {
    return undefined;
  }
  const relative = "Google Chrome.app/Contents/MacOS/Google Chrome";
  const candidates = [
    path.join("/Applications", relative),
    path.join(os.homedir(), "Applications", relative),
  ];
  const installed = await Promise.all(
    candidates.map(async (candidate) =>
      (await Bun.file(candidate).exists()) ? candidate : undefined,
    ),
  );
  return installed.find((candidate) => candidate !== undefined);
}

export { chromeExecutable, extensionToken };
