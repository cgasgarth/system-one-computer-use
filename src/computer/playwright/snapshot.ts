import { z } from "zod";
import type { Window } from "../../agent/contracts.ts";

const pageSchema = z.object({ url: z.url(), title: z.string(), snapshot: z.string() });
const lineSchema = z.object({
  role: z.string(),
  name: z.string(),
  ref: z.string().regex(/^e\d+$/u),
  suffix: z.string(),
});
const EDITABLE = new Set(["textbox", "searchbox", "combobox", "spinbutton"]);
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

function snapshotElements(snapshot: string): Window["elements"] {
  return snapshot.split("\n").flatMap((line, index) => {
    const match =
      /^\s*- (?<role>\w+)(?: "(?<name>.*?)")?[^\n]*?\[ref=(?<ref>e\d+)\](?<suffix>.*)$/u.exec(line);
    if (match === null) {
      return [];
    }
    const control = lineSchema.parse({ ...match.groups, name: match.groups?.["name"] ?? "" });
    const disabled = control.suffix.includes("[disabled]");
    const actions: string[] = [];
    if (!disabled && CLICKABLE.has(control.role)) {
      actions.push("AXPress");
    }
    if (!disabled && EDITABLE.has(control.role)) {
      actions.push("AXSetValue");
    }
    return [
      {
        actions,
        element_index: index,
        element_token: control.ref,
        label: control.name || control.role,
        role: control.role,
        value: control.suffix.includes(": ") ? control.suffix.split(": ").slice(1).join(": ") : "",
      },
    ];
  });
}

function parseSnapshot(text: string): Window {
  const page = pageSchema.parse({
    url: /^- Page URL: (?<url>.+)$/mu.exec(text)?.groups?.["url"],
    title: /^- Page Title: (?<title>.*)$/mu.exec(text)?.groups?.["title"] ?? "",
    snapshot: /```yaml\n(?<snapshot>[\s\S]*?)```/u.exec(text)?.groups?.["snapshot"],
  });
  return {
    app_name: "Google Chrome",
    elements: snapshotElements(page.snapshot),
    pid: 0,
    snapshot_id: crypto.randomUUID(),
    url: page.url,
    window_id: 0,
    window_title: page.title,
  };
}

export { parseSnapshot, snapshotElements };
