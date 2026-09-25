import { expect, test } from "bun:test";
import { browserKey } from "../src/computer/playwright/computer.ts";

test("translates harness navigation keys to Playwright key names", () => {
  expect(["return", "escape", "tab", "down", "up", "a"].map((key) => browserKey(key))).toEqual([
    "Enter",
    "Escape",
    "Tab",
    "ArrowDown",
    "ArrowUp",
    "a",
  ]);
});
