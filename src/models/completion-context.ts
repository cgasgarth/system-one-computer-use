import { relevantControls } from "../agent/controls.ts";
import { isEditableElement } from "../agent/contracts.ts";
import type { Window } from "../agent/contracts.ts";
import { MAX_STATE_CHARS, describeControl } from "./decision-context.ts";
import type { DecisionInput } from "./system-one.ts";

const TEXT_CONTENT = new Set([
  "AXStaticText",
  "AXTextArea",
  "text",
  "paragraph",
  "heading",
  "listitem",
]);
const OMISSION_NOTE_RESERVE = 100;

function controlEvidence(window: Window | undefined): string {
  if (window === undefined) {
    return "No controls observed.";
  }
  const controls = relevantControls(window);
  const selected = controls.filter((element) => element.selected === true);
  const fields = controls.filter(
    (element) =>
      element.selected !== true &&
      isEditableElement(element) &&
      element.value !== undefined &&
      element.value !== null &&
      element.value !== "",
  );
  const targets = controls.filter(
    (element) =>
      element.selected !== true &&
      !fields.includes(element) &&
      (element.actions ?? []).length > 0 &&
      (element.label?.length ?? 0) > 0,
  );
  const content = controls.filter(
    (element) =>
      element.selected !== true &&
      !fields.includes(element) &&
      !targets.includes(element) &&
      (TEXT_CONTENT.has(element.role) ||
        (element.value !== undefined && element.value !== null && element.value !== "")),
  );
  const ordered = [...selected, ...fields, ...targets, ...content];
  const descriptions = ordered.map(
    (element) =>
      `${describeControl(element)}${element.selected === true && isEditableElement(element) ? " (selected)" : ""}`,
  );
  let evidence = "";
  let included = 0;
  for (const description of descriptions) {
    const next = evidence.length === 0 ? description : `${evidence} | ${description}`;
    if (next.length > MAX_STATE_CHARS - OMISSION_NOTE_RESERVE) {
      break;
    }
    evidence = next;
    included += 1;
  }
  const omitted = descriptions.length - included;
  return `${evidence}${omitted > 0 ? ` [${omitted} observed controls omitted due to size; omission does not prove absence.]` : ""}`;
}

function completionState(input: DecisionInput): string {
  const { window } = input.observation;
  return [
    `User request: ${input.task}`,
    `Observed application: ${window?.app_name ?? input.observation.application?.name} is open. This alone does not establish that a requested item or its content is open.`,
    window === undefined
      ? "No controllable window is available."
      : `Window title: ${window.window_title}.`,
    ...(window?.url === undefined ? [] : [`Current URL: ${window.url}`]),
    `Observed controls and values (listing alone does not prove target content is open): ${controlEvidence(window)}`,
    ...(input.context === undefined
      ? []
      : [`Previous session context (reference only): ${input.context}`]),
    ...(input.completionEvidence === undefined
      ? []
      : [`Executed actions in this request: ${input.completionEvidence}`]),
    ...(window?.elements.some((element) =>
      ["AXPopover", "AXSheet", "AXDialog"].includes(element.role),
    ) === true
      ? [
          "A dialog or popover is still open. Its text fields can contain unsubmitted input. Verify the requested creation, saving, or submission before declaring completion.",
        ]
      : []),
  ].join("\n");
}

function completionTargetState(input: DecisionInput): string {
  const { window } = input.observation;
  const contents =
    window?.elements.map((element) => describeControl(element)).join(" | ") ??
    "No window selected.";
  return [
    `User request: ${input.task}`,
    `Previous session context (references only): ${input.context ?? ""}`,
    `Executed actions in this request: ${input.completionEvidence ?? ""}`,
    `Selected application: ${input.observation.application?.name ?? window?.app_name ?? "None"}`,
    `Current window: ${window === undefined ? "None" : `${window.app_name}: ${window.window_title}`}`,
    ...(window?.url === undefined ? [] : [`Current URL: ${window.url}`]),
    `Current content: ${contents.slice(0, MAX_STATE_CHARS)}`,
  ].join("\n");
}

export { completionState, completionTargetState };
