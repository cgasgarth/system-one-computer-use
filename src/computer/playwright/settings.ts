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

export { extensionToken };
