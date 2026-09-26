import { z } from "zod";
import type { PlaywrightConnection } from "./connection.ts";
import { parseSnapshot } from "./snapshot.ts";

const tabSchema = z.object({ index: z.coerce.number().int().nonnegative(), url: z.url() });
const extensionHost = "mmlmfjhmonkocbjadbfplnigmagldckm";

function isConnectionPage(url: string): boolean {
  const parsed = new URL(url);
  return (
    parsed.protocol === "chrome-extension:" &&
    parsed.hostname === extensionHost &&
    parsed.pathname === "/connect.html"
  );
}

function parseTabs(text: string): readonly z.infer<typeof tabSchema>[] {
  return text.split("\n").flatMap((line) => {
    const match = /^- (?<index>\d+): .*\]\((?<url>.*)\)$/u.exec(line);
    return match === null ? [] : [tabSchema.parse(match.groups)];
  });
}

async function closeConnectionPage(
  connection: Readonly<Pick<PlaywrightConnection, "call">>,
): Promise<void> {
  const tabs = parseTabs(
    await connection.call({ name: "browser_tabs", arguments: { action: "list" } }),
  );
  if (tabs.length > 0 && tabs.every((tab) => !isConnectionPage(tab.url))) {
    return;
  }
  await connection.call({
    name: "browser_tabs",
    arguments: { action: "new", url: "about:blank" },
  });
  const fresh = parseSnapshot(await connection.call({ name: "browser_snapshot" }));
  if (fresh.url !== "about:blank") {
    throw new Error("Chrome did not select the new blank tab.");
  }
  const currentTabs = parseTabs(
    await connection.call({ name: "browser_tabs", arguments: { action: "list" } }),
  );
  const welcome = currentTabs
    .filter((tab) => isConnectionPage(tab.url))
    .toSorted((left, right) => right.index - left.index);
  for (const tab of welcome) {
    // Tab indices change on close; remove them in descending order.
    // eslint-disable-next-line no-await-in-loop
    await connection.call({
      name: "browser_tabs",
      arguments: { action: "close", index: tab.index },
    });
  }
  const selected = parseSnapshot(await connection.call({ name: "browser_snapshot" }));
  if (selected.url !== "about:blank") {
    throw new Error("Chrome changed tabs while closing the connection page.");
  }
}

export { closeConnectionPage, isConnectionPage, parseTabs };
