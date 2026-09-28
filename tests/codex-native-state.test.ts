import { expect, test } from "bun:test";
import {
  appPid,
  menuElement,
  parseNativeMenuState,
  parseNativeState,
} from "../src/computer/codex-controls/native-state.ts";

const APP_ID = "com.example.Editor";
const OPEN_INDEX = 3;
const FOCUSED_INDEX = 8;
const scope = { appId: APP_ID, appName: "Editor", pid: appPid(APP_ID) };
const state = [
  'Window: "Document", App: Editor.',
  "0 standard window Document, ID: main",
  "\t1 group Content",
  "\t\t2 text field (settable, focused), Description: Title, Value: Draft",
  "\t\t3 button Save",
  "\t\t4 button (disabled), Description: Archive",
  "\t5 menu bar",
  "\t\t6 File",
  "\t\t\t7 menu item Open",
  "\t\t\t8 menu item (disabled), Description: Close",
].join("\n");

test("parses observed roles, ancestry, editable state, and menu paths", () => {
  const first = parseNativeState(state, scope).window;
  const second = parseNativeState(state, scope).window;
  expect(first.pid).toBe(appPid(APP_ID));
  expect(first.window_id).toBe(second.window_id);
  expect(first.elements[2]).toMatchObject({
    role: "AXTextField",
    label: "Title",
    value: "Draft",
    editable: true,
    focused: true,
    parent_index: 1,
  });
  expect(first.elements[4]).toMatchObject({ role: "AXButton", enabled: false });
  expect(first.menuNames).toEqual(["File"]);
  expect(first.menus).toEqual([
    { path: ["File", "Open"], label: "Open", enabled: true },
    { path: ["File", "Close"], label: "Close", enabled: false },
  ]);
  expect(first.menuComplete).toBe(false);
});

test("rejects duplicate AX indexes and missing active windows", () => {
  expect(() => parseNativeState(`${state}\n\t8 button Duplicate`, scope)).toThrow("duplicate");
  expect(() => parseNativeState("No window", scope)).toThrow("active app window");
});

test("preserves punctuation in observed native values", () => {
  const calculator = [
    'Window: "Calculator", App: Calculator.',
    "0 standard window Calculator, ID: main",
    "\t1 text Description: Edit field, Value: (, negative nine point six eight, )",
  ].join("\n");
  const parsed = parseNativeState(calculator, {
    appId: "com.apple.calculator",
    appName: "Calculator",
    pid: appPid("com.apple.calculator"),
  });
  expect(parsed.window.elements[1]?.value).toBe("(, negative nine point six eight, )");
});

test("uses observed descriptions and settable text entry area roles", () => {
  const observed = [
    'Window: "Editor", App: Editor.',
    "0 standard window Editor, ID: main",
    "\t1 button Description: 2, ID: Two",
    "\t2 text entry area (settable) Description: Task, Value: Draft",
  ].join("\n");
  const parsed = parseNativeState(observed, scope).window;
  expect(parsed.elements[1]).toMatchObject({ role: "AXButton", label: "2" });
  expect(parsed.elements[2]).toMatchObject({
    role: "AXTextArea",
    label: "Task",
    value: "Draft",
    editable: true,
    actions: ["AXSetValue"],
  });
});

test("binds focus only from one matching footer index and role", () => {
  const tree = [
    'Window: "Editor", App: Editor.',
    "0 standard window Editor, ID: main",
    "\t8 text entry area (settable) Description: Task, Value: Draft",
  ].join("\n");
  const footer =
    "The focused UI element is 8 text entry area (settable) Description: Task, Value: Draft";
  const valid = parseNativeState(`${tree}\n${footer}`, scope).window;
  expect(valid.elements.find((entry) => entry.element_index === FOCUSED_INDEX)?.focused).toBe(true);
  const absent = parseNativeState(
    `${tree}\nThe focused UI element is 9 text entry area Task`,
    scope,
  ).window;
  expect(absent.elements.some((entry) => entry.focused === true)).toBe(false);
  const wrongRole = parseNativeState(
    `${tree}\nThe focused UI element is 8 button Task`,
    scope,
  ).window;
  expect(wrongRole.elements.some((entry) => entry.focused === true)).toBe(false);
  const duplicate = parseNativeState(`${tree}\n${footer}\n${footer}`, scope).window;
  expect(duplicate.elements.some((entry) => entry.focused === true)).toBe(false);
});

test("keeps the presented dialog controls separate from controls behind it", () => {
  const dialog = [
    'Window: "Editor", App: Editor.',
    "0 standard window Editor, ID: main",
    "\t1 button Save",
    "\t2 dialog Confirm",
    "\t\t3 button Cancel",
  ].join("\n");
  const parsed = parseNativeState(dialog, scope);
  expect(parsed.window.elements.map((entry) => entry.label)).toEqual([
    "Editor",
    "Confirm",
    "Cancel",
  ]);
});

test("binds a transient menu tree to its owned prior window without inventing completeness", () => {
  const prior = parseNativeState(state, scope).window;
  const opened = [
    'Window: "Document", App: Editor.',
    "1 File, Secondary Actions: Cancel, Pick",
    "    2 menu Secondary Actions: Cancel",
    "        3 Open",
    "        4 (disabled) Close",
    "        5 Decimal Places",
    "            6 menu Secondary Actions: Cancel",
    "                7 Two",
  ].join("\n");
  const parsed = parseNativeMenuState(opened, { scope, prior, topLevel: "File" });
  expect(parsed.window_id).toBe(prior.window_id);
  expect(parsed.menuNames).toEqual(["File"]);
  expect(parsed.menuComplete).toBe(false);
  expect(parsed.menus?.map((entry) => [entry.path.join(" > "), entry.enabled])).toEqual([
    ["File > Open", true],
    ["File > Close", false],
    ["File > Decimal Places", true],
    ["File > Decimal Places > Two", true],
  ]);
  expect(menuElement(parsed, ["File", "Open"])?.element_index).toBe(OPEN_INDEX);
  expect(() => parseNativeMenuState(opened, { scope, prior, topLevel: "Edit" })).toThrow();
});
