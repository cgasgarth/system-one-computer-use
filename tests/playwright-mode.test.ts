import { expect, test } from "bun:test";
import { mcpArguments } from "../src/computer/playwright/connection.ts";

test("isolated browser mode starts headless Chrome without an extension", () => {
  const isolated = mcpArguments("isolated");
  expect(isolated).toContain("--browser");
  expect(isolated).toContain("chrome");
  expect(isolated).toContain("--headless");
  expect(isolated).toContain("--isolated");
  expect(isolated).not.toContain("--extension");
  const production = mcpArguments("extension");
  expect(production).toContain("--extension");
  expect(production).not.toContain("--isolated");
});
