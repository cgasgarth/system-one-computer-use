import { isEditableElement } from "../agent/contracts.ts";
import type { Window } from "../agent/contracts.ts";

const DIALOGS = new Set(["dialog", "alertdialog", "AXDialog", "AXSheet", "AXPopover"]);

function hasPendingDialogDraft(window: Window | undefined): boolean {
  if (window === undefined) {
    return false;
  }
  const dialog = window.elements.findLast((element) => DIALOGS.has(element.role));
  if (dialog === undefined) {
    return false;
  }
  const included = new Set([dialog.element_index]);
  for (const element of window.elements) {
    if (
      element.parent_index !== undefined &&
      element.parent_index !== null &&
      included.has(element.parent_index)
    ) {
      included.add(element.element_index);
    }
  }
  return window.elements.some(
    (element) =>
      included.has(element.element_index) &&
      isEditableElement(element) &&
      typeof element.value === "string" &&
      element.value.trim().length > 0,
  );
}

export { hasPendingDialogDraft };
