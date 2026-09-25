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
test("reports duplicate URLs and a tab change before returning a usable target", async () => {
  const ambiguous: Pick<PlaywrightConnection, "call"> = {
    async call() {
      return "- 0: [A](https://example.test/a)\n- 1: [A](https://example.test/a)";
    },
  };
  await expectFailure(restoreBrowser(ambiguous, saved), "ambiguous");
  const raced: Pick<PlaywrightConnection, "call"> = {
    async call(request) {
      return request.name === "browser_snapshot"
        ? snapshot.replace("https://example.test/a", "https://example.test/b")
        : "- 0: [A](https://example.test/a)";
    },
  };
  await expectFailure(restoreBrowser(raced, saved), "different tab");
});
