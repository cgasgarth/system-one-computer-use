import type { PlaywrightConnection } from "./connection.ts";
import type { Surface } from "../../agent/contracts.ts";
import { parseTabs } from "./tabs.ts";
import { parseSnapshot } from "./snapshot.ts";

async function browserBookmark(
  connection: Readonly<Pick<PlaywrightConnection, "call">>,
): Promise<Extract<Surface, { kind: "browser" }>> {
  const window = parseSnapshot(await connection.call({ name: "browser_snapshot" }));
  if (window.url === undefined) {
    throw new Error("The current Chrome tab has no URL");
  }
  return { kind: "browser", url: window.url, title: window.window_title };
}
async function restoreBrowser(
  connection: Readonly<Pick<PlaywrightConnection, "call">>,
  saved: Extract<Surface, { kind: "browser" }>,
): Promise<void> {
  const tabs = parseTabs(
    await connection.call({ name: "browser_tabs", arguments: { action: "list" } }),
  );
  const matches = tabs.filter((tab) => tab.url === saved.url);
  const [tab] = matches;
  if (matches.length === 1 && tab !== undefined) {
    await connection.call({
      name: "browser_tabs",
      arguments: { action: "select", index: tab.index },
    });
    const current = await browserBookmark(connection);
    if (current.url === saved.url) {
      return;
    }
  }
  await connection.call({
    name: "browser_tabs",
    arguments: { action: "new", url: "about:blank" },
  });
  const current = await browserBookmark(connection);
  if (current.url !== "about:blank") {
    throw new Error(
      "Chrome did not select the new blank tab. Observe the browser again before interacting.",
    );
  }
}
export { browserBookmark, restoreBrowser };
