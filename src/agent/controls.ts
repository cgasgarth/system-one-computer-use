import { isEditableElement } from "./contracts.ts";
import type { Window } from "./contracts.ts";

function textTargetName(element: Window["elements"][number]): string {
  const label = element.label?.trim() ?? "";
  if (
    element.role === "AXTextArea" &&
    (label.length === 0 || label === String(element.value ?? "").trim())
  ) {
    return "document editor";
  }
  return label.length === 0 ? element.role : label;
}

function priority(element: Window["elements"][number]): number {
  if (isEditableElement(element)) {
    return 0;
  }
  if (
    (element.actions ?? []).some((action) =>
      ["AXPress", "AXPick", "AXConfirm", "AXOpen"].includes(action),
    )
  ) {
    return 1;
  }
  const structural = 2;
  return structural;
}

function relevantControls(window: Window): Window["elements"] {
  // Put actionable controls first so structural rows cannot crowd out the editor.
  return window.elements.toSorted((left, right) => priority(left) - priority(right));
}
export { textTargetName, relevantControls };
