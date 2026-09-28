import type { Observation } from "./contracts.ts";

const CONTENT_ROLES = new Set([
  "AXStaticText",
  "AXHeading",
  "AXStatus",
  "AXAlert",
  "text",
  "heading",
  "status",
  "alert",
]);
const MAX_CONTENT_CHARS = 1800;
const MAX_VALUE_CHARS = 500;

// Displayed data is evidence; button names describe possible actions.
function screenContent(observation: Observation): string {
  const values =
    observation.window?.elements.flatMap((element) => {
      const { value } = element;
      const textLabel = CONTENT_ROLES.has(element.role) ? element.label : undefined;
      const content = value !== undefined && value !== null ? String(value) : textLabel;
      if (content === undefined) {
        return [];
      }
      const label = element.label === content ? "" : (element.label ?? "");
      return [
        `${element.role} ${JSON.stringify(label)}: ${JSON.stringify(content.slice(0, MAX_VALUE_CHARS))}`,
      ];
    }) ?? [];
  const text = [...new Set(values)].join("\n");
  return text.length <= MAX_CONTENT_CHARS
    ? text
    : `${text.slice(0, MAX_CONTENT_CHARS)}\n[Additional visible content omitted.]`;
}

function contentChange(previous: string, current: string): string {
  if (previous === current) {
    return "Observed text and values did not change after the last action. Do not infer task completion from the tool returning.";
  }
  return `Observed text and values changed after the last action. Previous content:\n${previous}\nCompare it with the current visible content above.`;
}

export { screenContent, contentChange };
