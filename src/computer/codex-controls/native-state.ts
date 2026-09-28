/* oxlint-disable unicorn/no-null -- The shared Window schema uses null for a root AX parent. */
/* oxlint-disable typescript/prefer-readonly-parameter-types -- The parser updates its private parent stack. */
import { createHash } from "node:crypto";
import { windowSchema } from "../../agent/contracts.ts";
import type { Window } from "../../agent/contracts.ts";
import { activeWindowElements } from "../native-scope.ts";

const HEADER = /^Window: "(?<title>.*)", App: (?<app>.*)\.$/u;
const LINE = /^(?<indent>[\t ]*)(?<index>\d+) (?<body>.*)$/u;
const FOCUS = /^The focused UI element is (?<index>\d+) (?<body>.*)$/u;
const ROOT_ID = /(?:^|, )ID: (?<id>[^,]+)/u;
const VALUE =
  /(?:;|, |^)value:\((?<value>.*)\)|(?:^|, )Value: (?<value2>.*?)(?=, (?:Secondary Actions|Help|ID):|$)/u;
const DESCRIPTION =
  /(?:^|, )Description: (?<text>.*?)(?=, (?:Help|ID|Value|Secondary Actions):|$)/u;
const SECONDARY = /Secondary Actions: (?<actions>.*)$/u;
const ROLE_NAMES = [
  ["standard window", "AXWindow"],
  ["dialog", "AXDialog"],
  ["sheet", "AXSheet"],
  ["popover", "AXPopover"],
  ["alert", "AXAlert"],
  ["menu bar item", "AXMenuBarItem"],
  ["menu bar", "AXMenuBar"],
  ["menu item", "AXMenuItem"],
  ["menu", "AXMenu"],
  ["text field", "AXTextField"],
  ["text entry area", "AXTextArea"],
  ["text area", "AXTextArea"],
  ["search field", "AXTextField"],
  ["pop up button", "AXPopUpButton"],
  ["check box", "AXCheckBox"],
  ["radio button", "AXRadioButton"],
  ["scroll area", "AXScrollArea"],
  ["split group", "AXSplitGroup"],
  ["table row", "AXRow"],
  ["row", "AXRow"],
  ["cell", "AXCell"],
  ["link", "AXLink"],
  ["button", "AXButton"],
  ["toolbar", "AXToolbar"],
  ["text", "AXStaticText"],
  ["group", "AXGroup"],
  ["container", "AXGroup"],
] as const;
const CLICK_ROLES = new Set([
  "AXButton",
  "AXLink",
  "AXMenuBarItem",
  "AXMenuItem",
  "AXPopUpButton",
  "AXCheckBox",
  "AXRadioButton",
  "AXRow",
  "AXCell",
]);
const TEXT_ROLES = new Set(["AXTextField", "AXTextArea"]);
const WINDOW_ROOT_ROLES = new Set(["AXWindow", "AXDialog", "AXSheet", "AXPopover", "AXAlert"]);
const WINDOW_BOUNDARY = 2_147_483_647;
const HEX_LENGTH = 8;
const MIN_MENU_PATH = 2;

type Element = Window["elements"][number];
interface NativeScope {
  readonly appId: string;
  readonly appName: string;
  readonly pid: number;
}
interface ParsedNativeState {
  readonly window: Window;
  readonly windowKey: string;
}
interface Parent {
  readonly depth: number;
  readonly index: number;
  readonly role: string;
}
interface ParseContext {
  readonly parents: Parent[];
  readonly scope: NativeScope;
  readonly key: string;
  readonly rootMenu?: string;
}

function stableId(value: string): number {
  const hex = createHash("sha256").update(value).digest("hex").slice(0, HEX_LENGTH);
  return (Number.parseInt(hex, 16) % WINDOW_BOUNDARY) + 1;
}
function appPid(appId: string): number {
  return stableId(`app:${appId}`);
}
function windowId(appId: string, key: string): number {
  return stableId(`window:${appId}:${key}`);
}
function roleAndName(
  body: string,
  parentRole?: string,
  rootMenu?: string,
): { readonly role: string; readonly name: string } {
  if (
    parentRole === undefined &&
    rootMenu !== undefined &&
    (body === rootMenu || body.startsWith(`${rootMenu}, `))
  ) {
    return { role: "AXMenuBarItem", name: body };
  }
  for (const [name, role] of ROLE_NAMES) {
    if (body === name || body.startsWith(`${name} `) || body.startsWith(`${name},`)) {
      return { role, name: body.slice(name.length).trimStart().replace(/^, /u, "") };
    }
  }
  if (parentRole === "AXMenuBar") {
    return { role: "AXMenuBarItem", name: body };
  }
  if (parentRole === "AXMenuBarItem" || parentRole === "AXMenuItem" || parentRole === "AXMenu") {
    return { role: "AXMenuItem", name: body.replace(/^\((?:disabled|selected)\) /u, "") };
  }
  return { role: "AXUnknown", name: body };
}
function marker(body: string, name: string): boolean {
  return [...body.matchAll(/\((?<flags>[^)]*)\)/gu)].some(
    (match) => match.groups?.["flags"]?.split(", ").includes(name) === true,
  );
}
function label(name: string): string | undefined {
  const details = name.replace(/^\([^)]*\)(?:,? )?/u, "");
  const description = DESCRIPTION.exec(details)?.groups?.["text"]?.trim();
  if (description !== undefined && description.length > 0) {
    return description;
  }
  const own = details.split(/, (?:Help|ID|Value|Secondary Actions):/u)[0]?.trim();
  return own === undefined || own.length === 0 ? undefined : own;
}
function capabilities(role: string, body: string): string[] {
  const actions = CLICK_ROLES.has(role) ? ["AXPress"] : [];
  if (TEXT_ROLES.has(role) && marker(body, "settable")) {
    actions.push("AXSetValue");
  }
  const secondary = SECONDARY.exec(body)?.groups?.["actions"];
  if (secondary !== undefined) {
    actions.push(...secondary.split(", ").map((action) => `Secondary: ${action}`));
  }
  return actions;
}
function observedState(body: string, role: string): Partial<Element> {
  return {
    ...(marker(body, "disabled") ? { enabled: false } : {}),
    ...(marker(body, "selected") ? { selected: true } : {}),
    ...(marker(body, "focused") ? { focused: true } : {}),
    ...(TEXT_ROLES.has(role)
      ? { editable: marker(body, "settable") && !marker(body, "disabled") }
      : {}),
    actions: capabilities(role, body),
  };
}
function lineDepth(parts: Record<string, string | undefined>): number {
  return parts["indent"]?.length ?? 0;
}
function lineBody(parts: Record<string, string | undefined>): string {
  return parts["body"] ?? "";
}
function elementFromLine(line: string, context: ParseContext): Element | undefined {
  const { parents, scope, key, rootMenu } = context;
  const parts = LINE.exec(line)?.groups;
  if (parts === undefined) {
    return undefined;
  }
  const index = Number(parts["index"]);
  const depth = lineDepth(parts);
  const body = lineBody(parts);
  if (!Number.isSafeInteger(index)) {
    throw new TypeError("Codex returned an invalid accessibility index.");
  }
  while (parents.at(-1) !== undefined && (parents.at(-1)?.depth ?? 0) >= depth) {
    parents.pop();
  }
  const parent = parents.at(-1);
  const { role, name } = roleAndName(body, parent?.role, rootMenu);
  const observedLabel = label(name);
  const valueMatch = VALUE.exec(body)?.groups;
  const value = valueMatch?.["value"] ?? valueMatch?.["value2"];
  parents.push({ depth, index, role });
  return {
    element_index: index,
    parent_index: parent?.index ?? null,
    element_token: `${scope.appId}:${key}:${index}:${role}:${observedLabel ?? ""}`,
    role,
    ...(body.startsWith("search field") ? { subrole: "AXSearchField" } : {}),
    ...(observedLabel === undefined ? {} : { label: observedLabel }),
    ...(value === undefined ? {} : { value }),
    ...observedState(body, role),
  };
}
function parseElements(
  lines: readonly string[],
  context: Readonly<{ scope: NativeScope; key: string; expectedRoot?: string; rootMenu?: string }>,
): Element[] {
  const { scope, key, expectedRoot = "AXWindow", rootMenu } = context;
  const elements: Element[] = [];
  const parents: Parent[] = [];
  const seen = new Set<number>();
  for (const line of lines) {
    const element = elementFromLine(line, {
      parents,
      scope,
      key,
      ...(rootMenu === undefined ? {} : { rootMenu }),
    });
    if (element !== undefined) {
      if (seen.has(element.element_index)) {
        throw new Error("Codex returned duplicate accessibility indexes.");
      }
      seen.add(element.element_index);
      elements.push(element);
    }
  }
  if (
    expectedRoot === "AXWindow"
      ? !WINDOW_ROOT_ROLES.has(elements[0]?.role ?? "")
      : elements[0]?.role !== expectedRoot
  ) {
    throw new Error("Codex returned no indexed window tree.");
  }
  return elements;
}
function withObservedFocus(text: string, elements: Element[]): Element[] {
  const footers = text.split("\n").flatMap((line) => {
    const match = FOCUS.exec(line);
    return match?.groups === undefined ? [] : [match.groups];
  });
  const [footer] = footers;
  if (footers.length !== 1 || footer === undefined) {
    return elements;
  }
  const { index: rawIndex, body } = footer;
  const index = Number(rawIndex);
  const matches = elements.filter((entry) => entry.element_index === index);
  const [element] = matches;
  if (
    body === undefined ||
    matches.length !== 1 ||
    element === undefined ||
    roleAndName(body).role !== element.role
  ) {
    return elements;
  }
  const position = elements.indexOf(element);
  elements[position] = { ...element, focused: true };
  return elements;
}
function menuPath(index: number, elements: readonly Element[]): string[] | undefined {
  const path: string[] = [];
  let current = elements.find((entry) => entry.element_index === index);
  while (current !== undefined) {
    if (current.role === "AXMenuItem" || current.role === "AXMenuBarItem") {
      if (current.label === undefined) {
        return undefined;
      }
      path.unshift(current.label);
    }
    if (current.role === "AXMenuBar") {
      return path;
    }
    if (current.role === "AXMenuBarItem" && current.parent_index === null) {
      return path;
    }
    const parent = current.parent_index;
    current = elements.find((entry) => entry.element_index === parent);
  }
  return undefined;
}
function menuData(
  elements: readonly Element[],
): Pick<Window, "menus" | "menuNames" | "menuComplete"> {
  const menus = elements
    .filter((entry) => entry.role === "AXMenuItem")
    .flatMap((entry) => {
      const path = menuPath(entry.element_index, elements);
      return path === undefined || path.length < MIN_MENU_PATH
        ? []
        : [{ path, label: entry.label ?? "", enabled: entry.enabled !== false }];
    });
  const menuNames = elements
    .filter((entry) => entry.role === "AXMenuBarItem")
    .flatMap((entry) => {
      const path = menuPath(entry.element_index, elements);
      return path?.length === 1 ? path : [];
    });
  return { menus, menuNames, menuComplete: false };
}
function menuElement(window: Window, expected: readonly string[]): Element | undefined {
  const matches = window.elements.filter((entry) => {
    if (entry.role !== "AXMenuItem") {
      return false;
    }
    const path = menuPath(entry.element_index, window.elements);
    return (
      path !== undefined &&
      path.length === expected.length &&
      path.every((part, index) => part === expected[index])
    );
  });
  return matches.length === 1 ? matches[0] : undefined;
}
function parseNativeState(text: string, scope: NativeScope): ParsedNativeState {
  const [header, ...lines] = text.split("\n");
  const title = HEADER.exec(header ?? "")?.groups?.["title"];
  if (title === undefined || title.length === 0) {
    throw new Error("Codex did not report an active app window.");
  }
  const rootLine = lines.find((line) => line.startsWith("0 "));
  const rootKey = ROOT_ID.exec(rootLine ?? "")?.groups?.["id"]?.trim() ?? title;
  const key = `${title}\u0000${rootKey}`;
  const allElements = parseElements(lines, { scope, key });
  const elements = withObservedFocus(text, [
    ...activeWindowElements({
      app_name: scope.appName,
      pid: scope.pid,
      window_id: windowId(scope.appId, key),
      window_title: title,
      snapshot_id: "",
      elements: allElements,
    }),
  ]);
  const window = windowSchema.safeParse({
    app_name: scope.appName,
    pid: scope.pid,
    window_id: windowId(scope.appId, key),
    window_title: title,
    snapshot_id: createHash("sha256").update(text).digest("hex"),
    elements,
    ...menuData(elements),
  });
  if (!window.success) {
    throw new Error("Codex returned incomplete indexed window data. Observe the app again.", {
      cause: window.error,
    });
  }
  return {
    windowKey: key,
    window: window.data,
  };
}

function parseNativeMenuState(
  text: string,
  context: Readonly<{ scope: NativeScope; prior: Window; topLevel: string }>,
): Window {
  const { scope, prior, topLevel } = context;
  const [header, ...lines] = text.split("\n");
  const title = HEADER.exec(header ?? "")?.groups?.["title"];
  if (title !== prior.window_title || prior.pid !== scope.pid) {
    throw new Error("The app window changed while its menu was open.");
  }
  const elements = withObservedFocus(
    text,
    parseElements(lines, {
      scope,
      key: String(prior.window_id),
      expectedRoot: "AXMenuBarItem",
      rootMenu: topLevel,
    }),
  );
  if (elements[0]?.label !== topLevel) {
    throw new Error("A different native menu is open. Observe the app again.");
  }
  const result = windowSchema.safeParse({
    app_name: scope.appName,
    pid: prior.pid,
    window_id: prior.window_id,
    window_title: title,
    snapshot_id: createHash("sha256").update(text).digest("hex"),
    elements,
    ...menuData(elements),
  });
  if (!result.success) {
    throw new Error("Codex returned incomplete open-menu data. Observe the app again.", {
      cause: result.error,
    });
  }
  return result.data;
}

export { appPid, menuElement, parseNativeMenuState, parseNativeState, windowId };
export type { NativeScope, ParsedNativeState };
