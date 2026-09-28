import type { Window } from "../agent/contracts.ts";

const PRESENTED_ROLES = new Set(["AXPopover", "AXSheet", "AXDialog", "AXAlert"]);
function activeWindowElements(window: Window): Window["elements"] {
  const presented = new Set(
    window.elements
      .filter((element) => PRESENTED_ROLES.has(element.role))
      .map((element) => element.element_index),
  );
  if (presented.size === 0) {
    return window.elements;
  }
  // The observed AX walk is parent-before-child. Keep the presented subtree.
  for (const element of window.elements) {
    if (
      element.parent_index !== undefined &&
      element.parent_index !== null &&
      presented.has(element.parent_index)
    ) {
      presented.add(element.element_index);
    }
  }
  return window.elements.filter(
    (element) => element.role === "AXWindow" || presented.has(element.element_index),
  );
}
export { activeWindowElements };
