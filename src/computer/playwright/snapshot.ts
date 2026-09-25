import { z } from "zod";
import { isMap, isScalar, isSeq, parseDocument, visit } from "yaml";
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
  "switch",
  "combobox",
]);

const scalarValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);
interface ControlOptions {
  readonly href?: string;
  readonly nested: boolean;
}
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

function snapshotElements(snapshot: string, baseUrl?: string): Window["elements"] {
  const document = parseDocument(snapshot);
  if (document.errors.length > 0) {
    throw new Error("Playwright returned an invalid YAML snapshot");
  }
  const elements: Window["elements"][number][] = [];
  function add(
    descriptor: string,
    value: z.infer<typeof scalarValue>,
    options: ControlOptions,
  ): void {
    const control = parseControl(descriptor);
    if (control === undefined) {
      return;
    }
    const disabled = control.suffix.includes("[disabled]");
    const actions: string[] = [];
    if (!disabled && CLICKABLE.has(control.role)) {
      actions.push("AXPress");
    }
    if (
      !disabled &&
      EDITABLE.has(control.role) &&
      !(control.role === "combobox" && options.nested)
    ) {
      actions.push("AXSetValue");
    }
    elements.push({
      actions,
      element_index: elements.length,
      element_token: control.ref,
      label: control.name || control.role,
      role: control.role,
      ...controlState(control, value),
      ...(options.href === undefined ? {} : { href: options.href }),
    });
  }
  visit(document, {
    Pair(_key, pair) {
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
      add(descriptor.data, value, {
        nested: isSeq(pair.value),
        ...(href === undefined ? {} : { href }),
      });
    },
    Scalar(key, node) {
      if (typeof key !== "number") {
        return;
      }
      const descriptor = z.string().safeParse(node.value);
      if (descriptor.success) {
        add(descriptor.data, "", { nested: false });
      }
    },
  });
  return elements;
}

function parseSnapshot(text: string): Window {
  const page = pageSchema.parse({
    url: /^- Page URL: (?<url>.+)$/mu.exec(text)?.groups?.["url"],
    title: /^- Page Title: (?<title>.*)$/mu.exec(text)?.groups?.["title"] ?? "",
    snapshot: /```yaml\n(?<snapshot>[\s\S]*?)```/u.exec(text)?.groups?.["snapshot"],
  });
  return {
    app_name: "Google Chrome",
    elements: snapshotElements(page.snapshot, page.url),
    pid: 0,
    snapshot_id: crypto.randomUUID(),
    url: page.url,
    window_id: 0,
    window_title: page.title,
  };
}

export { parseSnapshot, snapshotElements };
