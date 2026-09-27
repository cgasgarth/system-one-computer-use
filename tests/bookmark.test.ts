import { expect, test } from "bun:test";
import { browserBookmark, restoreBrowser } from "../src/computer/playwright/bookmark.ts";
import type { PlaywrightConnection } from "../src/computer/playwright/connection.ts";
import { expectFailure } from "./fixtures.ts";

const saved = { kind: "browser", url: "https://example.test/a", title: "A" } as const;
const snapshot =
  '### Page\n- Page URL: https://example.test/a\n- Page Title: A\n### Snapshot\n```yaml\n- heading "A" [level=1]\n```';
test("restores the unique saved URL through the extension and verifies it", async () => {
  const selected: number[] = [];
  const connection: Pick<PlaywrightConnection, "call"> = {
    async call(request) {
      if (request.name === "browser_snapshot") {
        return snapshot;
      }
      if (request.arguments?.["action"] === "select") {
        expect(request.arguments["index"]).toBe(1);
        selected.push(1);
        return "Selected";
      }
      return "- 0: [Other](https://example.test/other)\n- 1: [A](https://example.test/a)";
    },
  };
  await restoreBrowser(connection, saved);
  expect(selected).toEqual([1]);
  const current = await browserBookmark(connection);
  expect(current.url).toBe(saved.url);
});
for (const listing of [
  "- 0: [Other](https://example.test/other)",
  "- 0: [A](https://example.test/a)\n- 1: [A](https://example.test/a)",
]) {
  test("creates a blank task tab when the saved tab cannot be identified", async () => {
    const calls: string[] = [];
    const connection: Pick<PlaywrightConnection, "call"> = {
      async call(request) {
        if (request.name === "browser_snapshot") {
          return snapshot.replace("https://example.test/a", "about:blank");
        }
        const action = String(request.arguments?.["action"]);
        calls.push(action);
        if (action === "new") {
          expect(request.arguments?.["url"]).toBe("about:blank");
        }
        return listing;
      },
    };
    await restoreBrowser(connection, saved);
    expect(calls).toEqual(["list", "new"]);
  });
}
test("rejects a new tab when Chrome selects a different page", async () => {
  const connection: Pick<PlaywrightConnection, "call"> = {
    async call(request) {
      return request.name === "browser_snapshot" ? snapshot : "";
    },
  };
  await expectFailure(restoreBrowser(connection, saved), "did not select the new blank tab");
});
