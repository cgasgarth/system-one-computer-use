/* oxlint-disable typescript/prefer-readonly-parameter-types -- Zod schemas and the mutable fake are test boundaries. */
import { expect, test } from "bun:test";
import type { z } from "zod";
import { taskDesktop } from "../src/computer/targets.ts";
import { CodexChromeComputer } from "../src/computer/codex-chrome/computer.ts";
import { parseAxWindow } from "../src/computer/codex-chrome/snapshot.ts";

const page = {
  state: `Browser tab: 12, Title: "Form", URL: "https://example.test/form".
0 AXWebArea Form, URL: example.test/form
\t1 heading Form, Value: 1
\t\t2 text Form
\t3 textbox Description: Project name, Value: Draft
\t4 button Description: Save
\t5 button Description: Cancel, Disabled
The focused UI element is 3 textbox Description: Project name`,
  url: "https://example.test/form",
  title: "Form",
  tabId: "12",
};

class FakeWire {
  public readonly reads: string[] = [];
  public readonly acts: string[] = [];
  public readonly replies: unknown[];
  public closed = false;
  public readyCount = 0;

  public constructor(replies: readonly unknown[]) {
    this.replies = [...replies];
  }

  public async ready(): Promise<void> {
    this.readyCount += 1;
  }

  public async read<Output>(code: string, schema: Readonly<z.ZodType<Output>>): Promise<Output> {
    this.reads.push(code);
    return schema.parse(this.replies.shift());
  }

  public async act(code: string): Promise<void> {
    this.acts.push(code);
  }

  public async close(): Promise<void> {
    this.closed = true;
  }
}

function computer(wire: FakeWire): CodexChromeComputer {
  return new CodexChromeComputer({ approval: async () => ({ action: "cancel" }), wire });
}

test("maps browser indices, values, focus and disabled controls", () => {
  const window = parseAxWindow(page);
  expect(window.elements.map((item) => [item.element_token, item.role])).toEqual([
    ["ax:1", "heading"],
    ["ax:2", "text"],
    ["ax:3", "textbox"],
    ["ax:4", "button"],
    ["ax:5", "button"],
  ]);
  expect(window.elements[2]).toMatchObject({
    label: "Project name",
    value: "Draft",
    focused: true,
    actions: ["AXSetValue"],
  });
  expect(window.elements[4]).toMatchObject({ enabled: false, actions: [] });
});

test("maps Chrome multiword text and native select roles", () => {
  const window = parseAxWindow({
    ...page,
    state: `0 AXWebArea Form
\t8 text field (settable) Display name, Value: Initial name
\t10 text entry area (settable) Summary, Value: Initial summary
\t12 pop up button (collapsed, settable) Priority, Value: Normal, Secondary Actions: Expand
The focused UI element is 8 text field (settable) Display name`,
  });
  expect(window.elements.map((item) => [item.role, item.label, item.value])).toEqual([
    ["textbox", "Display name", "Initial name"],
    ["textbox", "Summary", "Initial summary"],
    ["combobox", "Priority", "Normal"],
  ]);
  expect(window.elements[0]?.actions).toEqual(["AXSetValue"]);
  expect(window.elements[2]?.editable).toBe(false);
});

test("keeps only controls in the current dialog", () => {
  const window = parseAxWindow({
    ...page,
    state:
      "0 AXWebArea Form\n\t1 button Description: Background\n\t2 dialog Save\n\t\t3 textbox Description: Name\n\t\t4 button Description: Confirm",
  });
  expect(window.elements.map((item) => item.label)).toEqual(["Save", "Name", "Confirm"]);
});

test("creates one task tab and binds actions to observed AX indices", async () => {
  const wire = new FakeWire([{ browserId: "chrome-1", tabId: "12" }, page, page, page]);
  const browser = computer(wire);
  await browser.desktop();
  const window = await browser.window();
  expect(window.url).toBe(page.url);
  await browser.clickElement({
    kind: "click_element",
    pid: 0,
    window_id: 0,
    element_token: "ax:4",
    reason: "Save",
  });
  await browser.window();
  await browser.typeText({
    kind: "type_text",
    pid: 0,
    window_id: 0,
    element_token: "ax:3",
    text: "Ready",
    reason: "Enter name",
  });
  await browser.window();
  await browser.pressKey({
    kind: "press_key",
    pid: 0,
    window_id: 0,
    element_token: "ax:3",
    key: "return",
    modifiers: ["cmd"],
    reason: "Press key",
  });
  expect(wire.reads.filter((code) => code.includes("tabs.new()"))).toHaveLength(1);
  expect(wire.acts).toEqual([
    "await s1Tab.ax.click(4)",
    'await s1Tab.ax.setValue(3,"Ready")',
    'await s1Tab.ax.pressKey(3,"super+Return")',
  ]);
});

test("rejects stale and unobserved control tokens before Chrome input", async () => {
  const wire = new FakeWire([{ browserId: "chrome-1", tabId: "12" }, page]);
  const browser = computer(wire);
  await browser.window();
  const save = {
    kind: "click_element" as const,
    pid: 0,
    window_id: 0,
    element_token: "ax:4",
    reason: "Save",
  };
  expect(browser.clickElement({ ...save, element_token: "ax:99" })).rejects.toThrow(
    "control changed",
  );
  await browser.clickElement(save);
  expect(browser.clickElement(save)).rejects.toThrow("control changed");
  expect(wire.acts).toEqual(["await s1Tab.ax.click(4)"]);
});

test("inspects the exact button and text field", async () => {
  const wire = new FakeWire([
    { browserId: "chrome-1", tabId: "12" },
    page,
    true,
    // eslint-disable-next-line unicorn/no-null -- Browser DOM metadata uses JSON null.
    { tagName: "input", inputType: "text", formRole: null, formMethod: "post" },
  ]);
  const browser = computer(wire);
  await browser.window();
  const inspection = await browser.inspectClick({
    kind: "click_element",
    pid: 0,
    window_id: 0,
    element_token: "ax:4",
    reason: "Save",
  });
  expect(inspection.kind).toBe("form_submit");
  const field = await browser.inspectField({
    kind: "compose_text",
    pid: 0,
    window_id: 0,
    element_token: "ax:3",
    reason: "Name",
  });
  expect(field.formMethod).toBe("post");
  expect(wire.reads.at(-1)).toContain("s1Locator.evaluate");
});

test("offers native select values from a grounded combobox", async () => {
  const wire = new FakeWire([
    { browserId: "chrome-1", tabId: "12" },
    { ...page, state: "0 AXWebArea Form\n\t1 combobox Description: Priority, Value: Low" },
    [
      {
        label: "Priority",
        options: [
          { label: "Low", value: "low", selected: true, disabled: false },
          { label: "High", value: "high", selected: false, disabled: false },
        ],
      },
    ],
  ]);
  const browser = computer(wire);
  const window = await browser.window();
  const option = window.elements.find((item) => item.role === "option" && item.label === "High");
  expect(option?.actions).toEqual(["AXPick"]);
  await browser.clickElement({
    kind: "click_element",
    operation: "pick",
    pid: 0,
    window_id: 0,
    element_token: option?.element_token ?? "",
    reason: "Pick High",
  });
  expect(wire.acts[0]).toContain('selectOption({value:"high"})');
});

test("bookmarks and restores only the exact task tab", async () => {
  const wire = new FakeWire([
    { browserId: "chrome-1", tabId: "12" },
    {
      browserId: "chrome-1",
      tabId: "12",
      providerTabId: "opaque-12",
      extensionInstanceId: "instance-1",
      url: page.url,
      title: "Form",
    },
    { browserId: "chrome-1", tabId: "12" },
  ]);
  const browser = computer(wire);
  const saved = await browser.bookmark();
  expect(saved).toEqual({
    kind: "browser",
    browserId: "chrome-1",
    tabId: "12",
    providerTabId: "opaque-12",
    extensionInstanceId: "instance-1",
    url: page.url,
    title: "Form",
  });
  expect(wire.reads[1]).toContain("markDeliverable");
  expect(wire.reads[1]?.indexOf("markDeliverable")).toBeGreaterThan(
    wire.reads[1]?.indexOf("providerTabId") ?? 0,
  );
  await browser.restore(saved);
  expect(wire.reads[2]).toContain('providerTabId==="opaque-12"');
  expect(wire.reads[2]).toContain('extensionInstanceId==="instance-1"');
  expect(wire.reads[2]).toContain('item.title==="Form"');
  expect(wire.reads[2]).toContain(`item.url===${JSON.stringify(page.url)}`);
  expect(wire.reads[2]).toContain("claimTab(released[0])");
  await browser.close();
  expect(wire.closed).toBe(false);
  expect(wire.acts).toEqual([]);
});

test("restores the same owned tab after its URL changes", async () => {
  const browser = computer(new FakeWire([{ browserId: "chrome-1", tabId: "12" }]));
  await browser.restore({
    kind: "browser",
    browserId: "chrome-1",
    tabId: "12",
    providerTabId: "opaque-12",
    extensionInstanceId: "instance-1",
    url: page.url,
    title: "Form",
  });
});

test("rejects a tab outside the saved browser identity", async () => {
  const browser = computer(new FakeWire([{ browserId: "other-browser", tabId: "12" }]));
  expect(
    browser.restore({
      kind: "browser",
      browserId: "chrome-1",
      tabId: "12",
      providerTabId: "opaque-12",
      extensionInstanceId: "instance-1",
      url: page.url,
      title: "Form",
    }),
  ).rejects.toThrow("saved Chrome profile changed");
});

test("hides Codex control apps from the task desktop", () => {
  const desktop = taskDesktop({
    apps: [
      { name: "Codex Computer Use", bundle_id: "com.openai.sky.CUAService", pid: 1 },
      { name: "Calculator", pid: 2 },
    ],
    windows: [
      { app_name: "Codex Computer Use", pid: 1, window_id: 1, title: "Authorization" },
      { app_name: "Calculator", pid: 2, window_id: 2, title: "Calculator" },
    ],
  });
  expect(desktop.windows.map((window) => window.app_name)).toEqual(["Calculator"]);
  expect(desktop.apps.map((app) => app.name)).toEqual(["Calculator"]);
});
