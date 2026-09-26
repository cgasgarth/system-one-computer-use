import { expect, test } from "bun:test";
import { taskDesktop } from "../src/computer/targets.ts";
import {
  parseSnapshot,
  selectedOption,
  snapshotElements,
} from "../src/computer/playwright/snapshot.ts";
import { settingsSchema } from "../src/app/settings-schema.ts";
import { isConnectionPage, parseTabs } from "../src/computer/playwright/tabs.ts";
import {
  applySelectMetadata,
  optionValue,
  parseSelectOptions,
  parseSubmitResult,
} from "../src/computer/playwright/computer.ts";

test("exposes only user application windows to the task loop", () => {
  const desktop = taskDesktop({
    apps: [
      { name: "Cua Driver", bundle_id: "com.trycua.driver", pid: 1 },
      { name: "Calculator", pid: 2 },
    ],
    windows: [
      { app_name: "Cua Driver", pid: 1, window_id: 1, title: "Authorization" },
      { app_name: "Calculator", pid: 2, window_id: 2, title: "Calculator" },
    ],
  });
  expect(desktop.windows.map((window) => window.app_name)).toEqual(["Calculator"]);
  expect(desktop.apps.map((app) => app.name)).toEqual(["Calculator"]);
});

test("maps Playwright references, editable values, and disabled controls", () => {
  const elements = snapshotElements(
    [
      '- textbox "Search" [ref=e1]: ORD to JFK',
      '- button "Find flights" [ref=e2]',
      '- button "Book" [ref=e3] [disabled]',
    ].join("\n"),
  );
  expect(elements.map((element) => element.actions)).toEqual([["AXSetValue"], ["AXPress"], []]);
  expect(elements[0]?.value).toBe("ORD to JFK");
  expect(elements[1]?.element_token).toBe("e2");
});

test("reads quoted YAML links and frame-qualified Playwright references", () => {
  const elements = snapshotElements(
    [
      "- 'link \"Example: Book a table\" [ref=f5e280] [cursor=pointer]':",
      "  - /url: https://example.com/",
      '  - heading "Example: Book a table" [ref=f5e281]',
      '- textbox "Name" [ref=f5e282]: Ada Lovelace',
    ].join("\n"),
    "https://www.google.com/search?q=example",
  );
  expect(elements[0]).toMatchObject({
    label: "Example: Book a table",
    element_token: "f5e280",
    href: "https://example.com/",
    actions: ["AXPress"],
  });
  expect(elements.at(-1)).toMatchObject({ value: "Ada Lovelace", actions: ["AXSetValue"] });
});

test("keeps state flags that appear before the Playwright reference", () => {
  const elements = snapshotElements(
    [
      '- textbox "Message" [active] [ref=e1]: Hello',
      '- button "Submit" [disabled] [ref=e2]',
      '- checkbox "Updates" [checked] [ref=e3]',
      '- tab "Details" [selected] [ref=e4]',
    ].join("\n"),
  );
  expect(elements[0]?.focused).toBe(true);
  expect(elements[1]?.enabled).toBe(false);
  expect(elements[1]?.actions).toEqual([]);
  expect(elements[2]?.value).toBe(true);
  expect(elements[3]?.selected).toBe(true);
});

test("reads nested input values without treating select menus as text fields", () => {
  const elements = snapshotElements(
    [
      '- combobox "Party size" [ref=e1]:',
      '  - option "2 people" [selected]',
      "- combobox [ref=e2]:",
      '  - textbox "Location" [ref=e3]:',
      "    - /placeholder: Restaurant or cuisine",
      "    - text: Chicago",
    ].join("\n"),
  );
  const inputs = elements.filter((element) => element.actions?.includes("AXSetValue") === true);
  expect(inputs).toHaveLength(1);
  expect(inputs[0]?.element_token).toBe("e3");
  expect(inputs[0]?.value).toBe("Chicago");
});

test("offers native select options without treating the select as a text field", () => {
  const elements = snapshotElements(
    ['- combobox "Priority" [ref=e1]:', '  - option "Low" [selected]', '  - option "High"'].join(
      "\n",
    ),
  );
  expect(elements[0]).toMatchObject({ editable: false, actions: ["AXPress"] });
  expect(elements[1]).toMatchObject({ selected: true, actions: [] });
  expect(elements[2]).toMatchObject({ parent_index: 0, actions: ["AXPick"] });
  expect(selectedOption(elements[2]?.element_token ?? "")).toEqual({
    target: "e1",
    index: 1,
    label: "High",
  });
});

test("distinguishes duplicate select labels by observed ordinal", () => {
  const elements = snapshotElements(
    ['- combobox "Priority" [ref=e1]:', '  - option "High"', '  - option "High"'].join("\n"),
  );
  expect(selectedOption(elements[1]?.element_token ?? "")?.index).toBe(0);
  expect(selectedOption(elements[2]?.element_token ?? "")?.index).toBe(1);
  expect(elements[1]?.element_token).not.toBe(elements[2]?.element_token);
});

test("exposes only active dialog controls to the browser decision", () => {
  const window = parseSnapshot(
    [
      "### Page",
      "- Page URL: https://example.test/projects",
      "- Page Title: Projects",
      "### Snapshot",
      "```yaml",
      '- button "New project" [ref=e1]',
      '- dialog "Create project":',
      '  - textbox "Project name" [ref=e2]: Draft',
      '  - button "Create project" [ref=e3]',
      '  - button "Cancel" [ref=e4]',
      "```",
    ].join("\n"),
  );
  expect(window.elements.map((element) => element.label)).toEqual([
    "Create project",
    "Project name",
    "Create project",
    "Cancel",
  ]);
});

test("validates the observed page URL before it can complete a task", () => {
  const text =
    '### Page\n- Page URL: https://example.com/\n- Page Title: Example\n### Snapshot\n```yaml\n- link "Learn more" [ref=e1]\n```';
  const window = parseSnapshot(text);
  expect(window.url).toBe("https://example.com/");
  expect(window.elements[0]?.label).toBe("Learn more");
  expect(() => parseSnapshot("### Error\nConnection failed")).toThrow();
});

test("settings accept provider-neutral HTTP endpoints and reject invalid URLs", () => {
  const settings = {
    decisionUrl: "http://127.0.0.1:8700/v1/systemone",
    decisionModel: "any-system-one-model",
    textUrl: "http://127.0.0.1:8080/v1/chat/completions",
    textModel: "small-text",
  };
  expect(settingsSchema.parse(settings)).toEqual(settings);
  expect(settingsSchema.safeParse({ ...settings, textUrl: "file:///tmp/model" }).success).toBe(
    false,
  );
});

test("identifies the Playwright connection tab without matching other pages", () => {
  const connection = "chrome-extension://mmlmfjhmonkocbjadbfplnigmagldckm/connect.html?client=test";
  const tabs = parseTabs(
    `### Result\n- 0: (current) [Welcome](${connection})\n- 1: [Page](https://example.com/)`,
  );
  expect(tabs.map((tab) => isConnectionPage(tab.url))).toEqual([true, false]);
  expect(isConnectionPage("https://example.com/connect.html")).toBe(false);
  expect(isConnectionPage("chrome-extension://mmlmfjhmonkocbjadbfplnigmagldckm/status.html")).toBe(
    false,
  );
});

test("reads exact-target form submit metadata from Playwright evaluation", () => {
  expect(parseSubmitResult('### Result\n{"formSubmit":true}\n### Ran Playwright code')).toEqual({
    formSubmit: true,
  });
  expect(parseSubmitResult('### Result\n{"formSubmit":false}\n### Ran Playwright code')).toEqual({
    formSubmit: false,
  });
  expect(() => parseSubmitResult("### Error\nTarget unavailable")).toThrow();
});

test("resolves a selected option by ordinal to its actual HTML value", () => {
  const options = parseSelectOptions(
    '### Result\n[{"label":"High","value":"internal-high","group":"Internal","selected":true,"disabled":false},{"label":"High","value":"external-high","group":"External","selected":false,"disabled":false}]\n### Ran Playwright code',
  );
  expect(optionValue({ target: "e1", index: 1, label: "High" }, options)).toBe("external-high");
  expect(() => optionValue({ target: "e1", index: 1, label: "Low" }, options)).toThrow("changed");
  expect(() =>
    optionValue({ target: "e1", index: 1, label: "High" }, [
      { label: "High", value: "internal-high", group: "Internal", selected: true, disabled: false },
      {
        label: "High",
        value: "internal-high",
        group: "External",
        selected: false,
        disabled: false,
      },
    ]),
  ).toThrow("duplicate option values");
  const window = parseSnapshot(
    '### Page\n- Page URL: https://example.test/select\n- Page Title: Select\n### Snapshot\n```yaml\n- combobox "Priority" [ref=e1]:\n  - option "High" [selected]\n  - option "High"\n```',
  );
  const enriched = applySelectMetadata(window, new Map([["e1", options]]));
  expect(enriched.elements.map((element) => element.label)).toEqual([
    "Priority",
    "Internal: High",
    "External: High",
  ]);
  expect(enriched.elements[0]?.value).toBe("Internal: High");
  expect(enriched.elements[2]?.actions).toEqual(["AXPick"]);
});
