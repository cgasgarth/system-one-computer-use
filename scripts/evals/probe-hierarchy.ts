import { loadConfig } from "../../src/app/config.ts";
import { PlaywrightConnection } from "../../src/computer/playwright/connection.ts";
import { closeConnectionPage, parseTabs } from "../../src/computer/playwright/tabs.ts";
import { startWorkspace } from "./workspace.ts";

const config = loadConfig();
const workspace = startWorkspace();
const connection = new PlaywrightConnection(config.PLAYWRIGHT_MCP_EXTENSION_TOKEN);
function snapshotOnly(output: string): string {
  return output.slice(output.indexOf("### Snapshot"));
}
try {
  await connection.call({ name: "browser_tabs", arguments: { action: "new", url: `${workspace.origin}/select-duplicate` } });
  await closeConnectionPage(connection);
  const select = snapshotOnly(await connection.call({ name: "browser_snapshot" }));
  await connection.call({ name: "browser_navigate", arguments: { url: `${workspace.origin}/panels/row` } });
  const row = snapshotOnly(await connection.call({ name: "browser_snapshot" }));
  console.log(JSON.stringify({ select, row }));
} finally {
  try {
    const tabs = parseTabs(await connection.call({ name: "browser_tabs", arguments: { action: "list" } }));
    const owned = tabs.find((tab) => tab.url.startsWith(workspace.origin));
    if (owned !== undefined) {
      await connection.call({ name: "browser_tabs", arguments: { action: "close", index: owned.index } });
    }
  } finally {
    await connection.close();
    await workspace.close();
  }
}
