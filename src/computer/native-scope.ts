import type { Window } from "../agent/contracts.ts";

const PRESENTED_ROLES = new Set(["AXPopover", "AXSheet", "AXDialog"]);
function activeWindowElements(window: Window): Window["elements"] {
  const presented = new Set(
    window.elements
      .filter(
        (element) =>
          PRESENTED_ROLES.has(element.role) &&
          element.frame !== undefined &&
          element.frame.w > 1 &&
          element.frame.h > 1,
      )
      .map((element) => element.element_index),
  );
  if (presented.size === 0) {
    return window.elements;
  }
  // CUA returns the AX walk in parent-before-child order. Use the full tree
  // Before the visibility filter can discard structural ancestors.
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
