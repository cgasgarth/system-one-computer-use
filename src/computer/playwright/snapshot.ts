import { z } from "zod";
import { isMap, isPair, isScalar, isSeq, parseDocument, visit } from "yaml";
import type { Pair } from "yaml";
import type { Window } from "../../agent/contracts.ts";

const pageSchema = z.object({ url: z.url(), title: z.string(), snapshot: z.string() });
const lineSchema = z.object({
  role: z.string(),
  name: z.string(),
  ref: z.string().regex(/^(?:f\d+)?e\d+$/u),
  suffix: z.string(),
});
const EDITABLE = new Set(["textbox", "searchbox", "combobox", "spinbutton"]);
const CHECKABLE = new Set(["checkbox", "radio", "switch", "menuitemcheckbox", "menuitemradio"]);
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
const PRESENTED = new Set(["dialog", "alertdialog"]);
const SELECT_PREFIX = "select:";

function selectToken(parent: string, index: number, option: string): string {
  return `${SELECT_PREFIX}${parent}:${index}:${encodeURIComponent(option)}`;
}

function selectedOption(
  token: string,
): { target: string; index: number; label: string } | undefined {
  const match = /^select:(?<target>(?:f\d+)?e\d+):(?<index>\d+):(?<label>.*)$/u.exec(token);
  if (
    match?.groups?.["target"] === undefined ||
    match.groups["index"] === undefined ||
    match.groups["label"] === undefined
  ) {
    return undefined;
  }
  return {
    target: match.groups["target"],
    index: z.coerce.number().int().nonnegative().parse(match.groups["index"]),
    label: decodeURIComponent(match.groups["label"]),
  };
}

const scalarValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);
interface ControlOptions {
  readonly href?: string;
  readonly nested: boolean;
  readonly parentIndex?: number;
  readonly selectParent?: string;
  readonly selectIndex?: number;
}
type Element = Window["elements"][number];
function controlState(
  control: Readonly<z.infer<typeof lineSchema>>,
  value: z.infer<typeof scalarValue>,
): Required<Pick<Window["elements"][number], "value" | "enabled" | "selected" | "focused">> {
  let content = value;
  if (CHECKABLE.has(control.role)) {
    content = control.suffix.includes("[checked=mixed]")
      ? "mixed"
      : control.suffix.includes("[checked]");
  }
  return {
    value: content,
    enabled: !control.suffix.includes("[disabled]"),
    selected: control.suffix.includes("[selected]"),
    focused: control.suffix.includes("[active]"),
  };
}

function parseControl(descriptor: string): z.infer<typeof lineSchema> | undefined {
  const match =
    /^(?<role>\w+)(?: "(?<name>.*?)")?(?<beforeRef>[^\n]*?)\[ref=(?<ref>(?:f\d+)?e\d+)\](?<suffix>.*)$/u.exec(
      descriptor,
    );
  if (match === null) {
    return undefined;
  }
  return lineSchema.parse({
    ...match.groups,
    name: match.groups?.["name"] ?? "",
    suffix: `${match.groups?.["beforeRef"] ?? ""}${match.groups?.["suffix"] ?? ""}`,
  });
}

function parseUnreferenced(
  descriptor: string,
): { role: string; name: string; suffix: string } | undefined {
  const match = /^(?<role>\w+)(?: "(?<name>.*?)")?(?<suffix>.*)$/u.exec(descriptor);
  return match?.groups?.["role"] === undefined
    ? undefined
    : {
        role: match.groups["role"],
        name: match.groups["name"] ?? "",
        suffix: match.groups["suffix"] ?? "",
      };
}

function parentIndex(
  path: readonly unknown[],
  indices: Readonly<WeakMap<Pair, number>>,
): number | undefined {
  for (let index = path.length - 1; index >= 0; index -= 1) {
    const node = path[index];
    if (isPair(node)) {
      const found = indices.get(node);
      if (found !== undefined) {
        return found;
      }
    }
  }
  return undefined;
}

function controlActions(input: {
  readonly role: string;
  readonly disabled: boolean;
  readonly nested: boolean;
  readonly option: boolean;
}): string[] {
  if (input.disabled) {
    return [];
  }
  const actions: string[] = [];
  if (CLICKABLE.has(input.role) && !input.option) {
    actions.push("AXPress");
  }
  if (input.option) {
    actions.push("AXPick");
  }
  if (EDITABLE.has(input.role) && !(input.role === "combobox" && input.nested)) {
    actions.push("AXSetValue");
  }
  return actions;
}

interface AddInput {
  readonly index: number;
  readonly descriptor: string;
  readonly value: z.infer<typeof scalarValue>;
  readonly options: ControlOptions;
}
// Snapshot node variants make this boundary branch-heavy; each branch maps one YAML form.
// eslint-disable-next-line eslint/complexity
function addControl({
  index,
  descriptor,
  value,
  options,
}: Readonly<AddInput>): Element | undefined {
  const control = parseControl(descriptor);
  const fallback = control === undefined ? parseUnreferenced(descriptor) : undefined;
  const role = control?.role ?? fallback?.role;
  if (role === undefined) {
    return undefined;
  }
  const option = control === undefined && role === "option" && options.selectParent !== undefined;
  if (control === undefined && !option && !PRESENTED.has(role)) {
    return undefined;
  }
  const name = control?.name ?? fallback?.name ?? "";
  const suffix = control?.suffix ?? fallback?.suffix ?? "";
  const token =
    control?.ref ??
    (option
      ? selectToken(options.selectParent ?? "", options.selectIndex ?? 0, name)
      : `structure:${index}`);
  const selected = suffix.includes("[selected]");
  const actions = controlActions({
    role,
    disabled: suffix.includes("[disabled]") || (option && selected),
    nested: options.nested,
    option: option && !selected,
  });
  return {
    actions,
    element_index: index,
    element_token: token,
    label: name || role,
    role,
    ...(options.parentIndex === undefined ? {} : { parent_index: options.parentIndex }),
    ...controlState({ role, name, ref: token, suffix }, value),
    ...(role === "combobox" && options.nested ? { editable: false } : {}),
    ...(options.href === undefined ? {} : { href: options.href }),
  };
}

function controlOptions(input: {
  readonly elements: readonly Element[];
  readonly indices: Readonly<WeakMap<Pair, number>>;
  readonly path: readonly unknown[];
  readonly nested: boolean;
  readonly href?: string;
}): ControlOptions {
  const found = parentIndex(input.path, input.indices);
  const parent = found === undefined ? undefined : input.elements[found];
  const selectIndex =
    parent?.role === "combobox"
      ? input.elements.filter(
          (element) => element.parent_index === found && element.role === "option",
        ).length
      : undefined;
  return {
    nested: input.nested,
    ...(found === undefined ? {} : { parentIndex: found }),
    ...(parent?.role === "combobox" ? { selectParent: parent.element_token } : {}),
    ...(selectIndex === undefined ? {} : { selectIndex }),
    ...(input.href === undefined ? {} : { href: input.href }),
  };
}

function snapshotElements(snapshot: string, baseUrl?: string): Window["elements"] {
  const document = parseDocument(snapshot);
  if (document.errors.length > 0) {
    throw new Error("Playwright returned an invalid YAML snapshot");
  }
  const elements: Window["elements"][number][] = [];
  const indices = new WeakMap<Pair, number>();
  visit(document, {
    Pair(_key, pair, path) {
      if (!isScalar(pair.key)) {
        return;
      }
      const descriptor = z.string().safeParse(pair.key.value);
      if (!descriptor.success) {
        return;
      }
      const children = isSeq(pair.value)
        ? pair.value.items.flatMap((item) => (isMap(item) ? item.items : []))
        : [];
      const link = children.find((item) => isScalar(item.key) && item.key.value === "/url");
      const text = children.find((item) => isScalar(item.key) && item.key.value === "text");
      const content =
        text !== undefined && isScalar(text.value) ? scalarValue.parse(text.value.value) : "";
      const value = isScalar(pair.value) ? scalarValue.parse(pair.value.value) : content;
      const url =
        link !== undefined && isScalar(link.value) ? z.string().parse(link.value.value) : undefined;
      const href =
        url !== undefined && baseUrl !== undefined ? new URL(url, baseUrl).href : undefined;
      const added = addControl({
        index: elements.length,
        descriptor: descriptor.data,
        value,
        options: controlOptions({
          elements,
          indices,
          path,
          nested: isSeq(pair.value),
          ...(href === undefined ? {} : { href }),
        }),
      });
      if (added !== undefined) {
        indices.set(pair, added.element_index);
        elements.push(added);
      }
    },
    Scalar(key, node, path) {
      if (typeof key !== "number") {
        return;
      }
      const descriptor = z.string().safeParse(node.value);
      if (descriptor.success) {
        const added = addControl({
          index: elements.length,
          descriptor: descriptor.data,
          value: "",
          options: controlOptions({ elements, indices, path, nested: false }),
        });
        if (added !== undefined) {
          elements.push(added);
        }
      }
    },
  });
  return elements;
}

function activeBrowserElements(elements: Window["elements"]): Window["elements"] {
  const presented = elements.findLast((element) => PRESENTED.has(element.role));
  if (presented === undefined) {
    return elements;
  }
  const included = new Set([presented.element_index]);
  for (const element of elements) {
    if (
      element.parent_index !== undefined &&
      element.parent_index !== null &&
      included.has(element.parent_index)
    ) {
      included.add(element.element_index);
    }
  }
  return elements.filter((element) => included.has(element.element_index));
}

function parseSnapshot(text: string): Window {
  const page = pageSchema.parse({
    url: /^- Page URL: (?<url>.+)$/mu.exec(text)?.groups?.["url"],
    title: /^- Page Title: (?<title>.*)$/mu.exec(text)?.groups?.["title"] ?? "",
    snapshot: /```yaml\n(?<snapshot>[\s\S]*?)```/u.exec(text)?.groups?.["snapshot"],
  });
  return {
    app_name: "Google Chrome",
    elements: activeBrowserElements(snapshotElements(page.snapshot, page.url)),
    pid: 0,
    snapshot_id: crypto.randomUUID(),
    url: page.url,
    window_id: 0,
    window_title: page.title,
  };
}

export { activeBrowserElements, parseSnapshot, selectedOption, snapshotElements };
