/* oxlint-disable typescript/prefer-readonly-parameter-types -- Fake SDK session input is mutable by its declared API. */
import { expect, test } from "bun:test";
import type { CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";
import { CodexNativeComputer } from "../src/computer/codex-controls/native-computer.ts";
import type { CodexControlsSession } from "../src/computer/codex-controls/app-server.ts";

const BASE = [
  'Window: "Document", App: Editor.',
  "0 standard window Document, ID: main",
  "\t1 group Content",
  "\t\t2 text field (settable, focused), Description: Title, Value: Draft",
  "\t\t3 button Save",
  "\t4 menu bar",
  "\t\t5 File",
].join("\n");
const OPEN = [
  'Window: "Document", App: Editor.',
  "1 File, Secondary Actions: Cancel, Pick",
  "    2 menu Secondary Actions: Cancel",
  "        3 Open",
  "        4 (disabled) Close",
].join("\n");
type Invoke = Parameters<CodexControlsSession["invoke"]>[0];
class FakeCodexSession {
  public state = BASE;
  public readonly calls: string[] = [];
  public closed = false;
  public async invoke(request: Invoke): Promise<CallToolResult> {
    this.calls.push(request.code);
    if (request.code.includes("cua.listApps")) {
      return FakeCodexSession.answer(request.code, [
        { id: "com.example.Editor", displayName: "Editor", isRunning: true },
      ]);
    }
    if (request.code.includes("getAXState")) {
      return FakeCodexSession.answer(request.code, { text: this.state });
    }
    if (request.code.includes("systemOneApp.click(5)")) {
      this.state = OPEN;
    }
    if (request.code.includes("systemOneApp.click(3)")) {
      this.state = BASE;
    }
    return { content: [{ type: "text", text: "ok" }] };
  }
  private static answer(code: string, value: unknown): CallToolResult {
    const marker = /nodeRepl\.write\((?<marker>"SYSTEM_ONE:[^"]+:")/u.exec(code)?.groups?.[
      "marker"
    ];
    if (marker === undefined) {
      throw new Error("Missing JSON marker");
    }
    return {
      content: [
        {
          type: "text",
          text: `${z.string().parse(JSON.parse(marker) as unknown)}${JSON.stringify(value)}`,
        },
      ],
    };
  }
  public async close(): Promise<void> {
    this.closed = true;
  }
}
const approval = async (): Promise<{ action: "cancel" }> => ({ action: "cancel" });
async function assertRejected(task: Promise<unknown>, message: string): Promise<void> {
  try {
    await task;
    throw new Error("Expected a rejected action");
  } catch (error) {
    expect(error instanceof Error && error.message.includes(message)).toBe(true);
  }
}

test("binds the active app window and acts only on a fresh matching control", async () => {
  const fake = new FakeCodexSession();
  const computer = new CodexNativeComputer({ approval }, fake);
  await computer.launchApp("Editor");
  const desktop = await computer.desktop();
  const [target] = desktop.windows;
  expect(target?.title).toBe("Document");
  const window = await computer.window(target?.pid ?? 0, target?.window_id ?? 0);
  const save = window.elements.find((entry) => entry.label === "Save");
  await computer.clickElement({
    kind: "click_element",
    pid: window.pid,
    window_id: window.window_id,
    element_token: save?.element_token ?? "",
    reason: "Save",
  });
  expect(fake.calls.some((code) => code.includes("systemOneApp.click(3)"))).toBe(true);
  fake.state = BASE.replace("button Save", "button Delete");
  await assertRejected(
    computer.clickElement({
      kind: "click_element",
      pid: window.pid,
      window_id: window.window_id,
      element_token: save?.element_token ?? "",
      reason: "Save",
    }),
    "changed",
  );
  expect(fake.calls.filter((code) => code.includes("systemOneApp.click(3)"))).toHaveLength(1);
  await computer.close();
  expect(fake.closed).toBe(true);
});

test("opens an observed menu and never invokes its disabled command", async () => {
  const fake = new FakeCodexSession();
  const computer = new CodexNativeComputer({ approval }, fake);
  await computer.launchApp("Editor");
  const desktop = await computer.desktop();
  const [target] = desktop.windows;
  const window = await computer.window(target?.pid ?? 0, target?.window_id ?? 0);
  const inspected = await computer.inspectMenu(
    {
      kind: "inspect_menu",
      pid: window.pid,
      window_id: window.window_id,
      topLevel: "File",
      reason: "View File",
    },
    window,
  );
  expect(inspected.complete).toBe(false);
  expect(inspected.menus.map((entry) => [entry.path.join(" > "), entry.enabled])).toEqual([
    ["File > Open", true],
    ["File > Close", false],
  ]);
  await computer.invokeMenu({
    kind: "invoke_menu",
    pid: window.pid,
    window_id: window.window_id,
    path: ["File", "Open"],
    reason: "Open",
  });
  expect(fake.calls.some((code) => code.includes("systemOneApp.click(3)"))).toBe(true);
  await assertRejected(
    computer.invokeMenu({
      kind: "invoke_menu",
      pid: window.pid,
      window_id: window.window_id,
      path: ["File", "Close"],
      reason: "Close",
    }),
    "unavailable",
  );
  expect(fake.calls.some((code) => code.includes("systemOneApp.click(4)"))).toBe(false);
  await computer.close();
});

test("rejects input when a different active app window takes the scope", async () => {
  const fake = new FakeCodexSession();
  const computer = new CodexNativeComputer({ approval }, fake);
  await computer.launchApp("Editor");
  const desktop = await computer.desktop();
  const [target] = desktop.windows;
  const window = await computer.window(target?.pid ?? 0, target?.window_id ?? 0);
  const save = window.elements.find((entry) => entry.label === "Save");
  fake.state = BASE.replaceAll("Document", "Other");
  await assertRejected(
    computer.clickElement({
      kind: "click_element",
      pid: window.pid,
      window_id: window.window_id,
      element_token: save?.element_token ?? "",
      reason: "Save",
    }),
    "window changed",
  );
  expect(fake.calls.some((code) => code.includes("systemOneApp.click(3)"))).toBe(false);
  await computer.close();
});

test("rejects a deterministic internal window-ID collision", async () => {
  const fake = new FakeCodexSession();
  fake.state = BASE.replaceAll("Document", "Doc574");
  const computer = new CodexNativeComputer({ approval }, fake);
  await computer.launchApp("Editor");
  const desktop = await computer.desktop();
  const [target] = desktop.windows;
  await computer.window(target?.pid ?? 0, target?.window_id ?? 0);
  fake.state = BASE.replaceAll("Document", "Doc99109");
  await assertRejected(
    computer.window(target?.pid ?? 0, target?.window_id ?? 0),
    "one internal target ID",
  );
  await computer.close();
});

test("sends documented Codex key names for a footer-focused native field", async () => {
  const fake = new FakeCodexSession();
  fake.state = `${BASE.replace("(settable, focused)", "(settable)")}\nThe focused UI element is 2 text field (settable) Description: Title, Value: Draft`;
  const computer = new CodexNativeComputer({ approval }, fake);
  await computer.launchApp("Editor");
  const desktop = await computer.desktop();
  const [target] = desktop.windows;
  const window = await computer.window(target?.pid ?? 0, target?.window_id ?? 0);
  const field = window.elements.find((entry) => entry.label === "Title");
  expect(field?.focused).toBe(true);
  const action = {
    kind: "press_key" as const,
    pid: window.pid,
    window_id: window.window_id,
    element_token: field?.element_token ?? "",
    modifiers: [] as const,
    reason: "Press focused key",
  };
  await computer.pressKey({ ...action, key: "return" });
  await computer.pressKey({ ...action, key: "escape" });
  await computer.pressKey({ ...action, key: "tab" });
  await computer.pressKey({ ...action, key: "up" });
  await computer.pressKey({ ...action, key: "down" });
  await computer.pressKey({ ...action, key: "return", modifiers: ["cmd"] });
  const sent = fake.calls.filter((code) => code.includes("systemOneApp.pressKey"));
  expect(sent).toEqual([
    'await systemOneApp.pressKey("Return");',
    'await systemOneApp.pressKey("Escape");',
    'await systemOneApp.pressKey("Tab");',
    'await systemOneApp.pressKey("Up");',
    'await systemOneApp.pressKey("Down");',
    'await systemOneApp.pressKey("super+Return");',
  ]);
  await computer.close();
});
