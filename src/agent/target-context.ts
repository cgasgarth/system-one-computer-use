import type { Window } from "./contracts.ts";

const MAX_NAME_CHARS = 100;
const MAX_ANCESTORS = 3;
const DUPLICATE_COUNT = 2;
const CONTAINER_ROLES = new Set([
  "row",
  "AXRow",
  "cell",
  "AXCell",
  "form",
  "AXGroup",
  "group",
  "dialog",
  "AXDialog",
  "section",
  "fieldset",
  "article",
  "listitem",
  "treeitem",
]);
type Element = Window["elements"][number];

function fullObservedName(element: Element): string | undefined {
  const label = element.label?.trim();
  const value = typeof element.value === "string" ? element.value.trim() : undefined;
  const name = label !== undefined && label.length > 0 && label !== element.role ? label : value;
  return name === undefined || name.length === 0 ? undefined : name;
}
function observedTargetName(element: Element): string | undefined {
  return fullObservedName(element)?.slice(0, MAX_NAME_CHARS);
}
function ancestorName(ancestor: Element, target: Element, window: Window): string | undefined {
  const named = fullObservedName(ancestor);
  if (named !== undefined) {
    return named;
  }
  const candidates = window.elements
    .filter((element) => element.parent_index === ancestor.element_index && element !== target)
    .filter((element) => ["heading", "cell", "AXCell", "AXStaticText"].includes(element.role))
    .map((element) => fullObservedName(element))
    .filter((name) => name !== undefined && name !== fullObservedName(target));
  return candidates.length === 1 ? candidates[0] : undefined;
}
function ancestorParts(target: Element, window: Window): readonly { role: string; name: string }[] {
  const byIndex = new Map(window.elements.map((element) => [element.element_index, element]));
  const parts: { role: string; name: string }[] = [];
  const seen = new Set<number>();
  let parent = target.parent_index;
  while (
    parent !== undefined &&
    parent !== null &&
    !seen.has(parent) &&
    parts.length < MAX_ANCESTORS
  ) {
    seen.add(parent);
    const ancestor = byIndex.get(parent);
    if (ancestor === undefined) {
      break;
    }
    const name = ancestorName(ancestor, target, window);
    if (name !== undefined && name !== fullObservedName(target)) {
      parts.push({ role: ancestor.role, name });
    }
    parent = ancestor.parent_index;
  }
  return parts;
}
function targetContainerContext(target: Element, window: Window): string | undefined {
  const parts = ancestorParts(target, window)
    .filter((part) => CONTAINER_ROLES.has(part.role))
    .map((part) => `${part.role} ${JSON.stringify(part.name)}`);
  return parts.length === 0 ? undefined : parts.join(" > ");
}
function targetDescriptionContext(target: Element, window: Window): string {
  const ancestors = ancestorParts(target, window).map(
    (part) => `${part.role} ${JSON.stringify(part.name.slice(0, MAX_NAME_CHARS))}`,
  );
  const peers = window.elements.filter(
    (element) =>
      element.role === target.role && fullObservedName(element) === fullObservedName(target),
  );
  const parts = [
    ...(ancestors.length === 0 ? [] : [`inside ${ancestors.join(" > ")}`]),
    ...(target.href === undefined
      ? []
      : [`destination ${JSON.stringify(target.href.slice(0, MAX_NAME_CHARS))}`]),
    ...(target.selected === true ? ["selected"] : []),
    ...(peers.length < DUPLICATE_COUNT
      ? []
      : [
          `occurrence ${peers.findIndex((element) => element.element_index === target.element_index) + 1} of ${peers.length}`,
          `window ${JSON.stringify(window.window_title.slice(0, MAX_NAME_CHARS))}`,
        ]),
  ];
  return parts.length === 0 ? "" : ` ${parts.join("; ")}`;
}

export { observedTargetName, targetContainerContext, targetDescriptionContext };
