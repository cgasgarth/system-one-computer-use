import { z } from "zod";
import type { Window } from "../../agent/contracts.ts";

const CLICKABLE = new Set([
  "button",
  "link",
  "checkbox",
  "radio",
  "tab",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "treeitem",
  "row",
  "switch",
  "combobox",
]);
const EDITABLE = new Set(["textbox", "searchbox", "combobox", "spinbutton"]);
const PRESENTED = new Set(["dialog", "alertdialog"]);
const ATTRIBUTE_OFFSET = 2;
const lineSchema = z.object({
  index: z.number().int().nonnegative(),
  role: z.string(),
  text: z.string(),
  nativeSelect: z.boolean(),
});
type Element = Window["elements"][number];

function parseLine(line: string): z.infer<typeof lineSchema> | undefined {
  const match = /^\s*(?<index>\d+)\s+(?<body>.*)$/u.exec(line);
  if (match?.groups?.["index"] === undefined || match.groups["body"] === undefined) {
    return undefined;
  }
  const { body } = match.groups;
  const prefixes: readonly (readonly [string, string])[] = [
    ["text entry area", "textbox"],
    ["text field", "textbox"],
    ["pop up button", "combobox"],
  ];
  const specialized = prefixes.find(([prefix]) => body.startsWith(`${prefix} `));
  const role = specialized?.[1] ?? body.split(" ")[0] ?? "";
  const text = body.slice(specialized?.[0].length ?? role.length).trim();
  return lineSchema.parse({
    index: Number(match.groups["index"]),
    role,
    text,
    nativeSelect: specialized?.[0] === "pop up button",
  });
}

function attribute(text: string, key: string): string | undefined {
  const start = text.indexOf(`${key}: `);
  if (start === -1) {
    return undefined;
  }
  const value = text.slice(start + key.length + ATTRIBUTE_OFFSET);
  return /^(?<first>.*?)(?:, (?:Description|Value|URL|Placeholder|Actions|Secondary Actions): |$)/u.exec(
    value,
  )?.groups?.["first"];
}

function label(text: string, role: string): string {
  const described = attribute(text, "Description");
  if (described !== undefined) {
    return described.trim();
  }
  const before =
    text
      .split(/, (?:Value|URL|Placeholder|Actions|Secondary Actions): /u)[0]
      ?.replace(/^(?:\([^)]*\)\s*)+/u, "")
      .trim() ?? "";
  return before.length > 0 ? before : role;
}

function actions(role: string, text: string, nativeSelect: boolean): string[] {
  if (/\b(?:Disabled|disabled)\b/u.test(text)) {
    return [];
  }
  return [
    ...(CLICKABLE.has(role) ? [role === "option" ? "AXPick" : "AXPress"] : []),
    ...(EDITABLE.has(role) && !nativeSelect ? ["AXSetValue"] : []),
  ];
}

function toElement(line: string, parent: number | undefined): Element | undefined {
  const parsed = parseLine(line);
  if (parsed === undefined || parsed.role === "AXWebArea") {
    return undefined;
  }
  const { index, role, text, nativeSelect } = parsed;
  const value = attribute(text, "Value");
  return {
    element_index: index,
    element_token: `ax:${index}`,
    role,
    label: label(text, role),
    ...(parent === undefined ? {} : { parent_index: parent }),
    ...(value === undefined ? {} : { value }),
    ...(attribute(text, "Placeholder") === undefined
      ? {}
      : { placeholder: attribute(text, "Placeholder") }),
    actions: actions(role, text, nativeSelect),
    enabled: !/\b(?:Disabled|disabled)\b/u.test(text),
    selected: /\b(?:Selected|selected|checked)\b/u.test(text),
    focused: /\b(?:Focused|focused)\b/u.test(text),
    editable: EDITABLE.has(role) && !nativeSelect,
  };
}

function activeElements(elements: readonly Element[]): Element[] {
  const dialog = elements.findLast((element) => PRESENTED.has(element.role));
  if (dialog === undefined) {
    return [...elements];
  }
  const included = new Set([dialog.element_index]);
  for (const element of elements) {
    if (typeof element.parent_index === "number" && included.has(element.parent_index)) {
      included.add(element.element_index);
    }
  }
  return elements.filter((element) => included.has(element.element_index));
}

function parseTree(state: string): { elements: Element[]; focused: number | undefined } {
  const lines = state.split("\n");
  const all: Element[] = [];
  const stack: { depth: number; index: number }[] = [];
  let focused: number | undefined = undefined;
  for (const line of lines) {
    const parsed = parseLine(line);
    if (parsed === undefined) {
      const match = /The focused UI element is (?<index>\d+) /u.exec(line);
      if (match?.groups?.["index"] !== undefined) {
        focused = Number(match.groups["index"]);
      }
    } else {
      const depth = /^\s*/u.exec(line)?.[0]?.length ?? 0;
      while (stack.at(-1) !== undefined && (stack.at(-1)?.depth ?? -1) >= depth) {
        stack.pop();
      }
      const parent = stack.at(-1)?.index;
      const element = toElement(line, parent);
      if (element !== undefined) {
        all.push(element);
      }
      stack.push({ depth, index: parsed.index });
    }
  }
  return { elements: activeElements(all), focused };
}

function parseAxWindow(input: {
  readonly state: string;
  readonly url: string;
  readonly title: string;
}): Window {
  const tree = parseTree(input.state);
  const elements: Element[] = [];
  for (const element of tree.elements) {
    elements.push({ ...element, focused: element.element_index === tree.focused });
  }
  return {
    app_name: "Google Chrome",
    pid: 0,
    window_id: 0,
    window_title: input.title,
    url: input.url,
    snapshot_id: crypto.randomUUID(),
    elements,
  };
}

function axIndex(token: string): number {
  const match = /^ax:(?<index>\d+)$/u.exec(token)?.groups?.["index"];
  if (match === undefined) {
    throw new Error("The browser control token is invalid. Observe the tab again.");
  }
  return Number(match);
}

export { axIndex, parseAxWindow };
