import { expect, test } from "bun:test";
import { contentChange, screenContent } from "../src/agent/screen-content.ts";
import { decisionState } from "../src/models/decision-context.ts";
import type { Observation } from "../src/agent/contracts.ts";

function observed(role: string, label: string, value?: string): Observation {
  return {
    desktop: { apps: [], windows: [] },
    window: {
      app_name: "Editor",
      pid: 1,
      window_id: 1,
      window_title: "Draft",
      snapshot_id: "current",
      elements: [
        ...Array.from({ length: 110 }, (_item, index) => ({
          element_index: index,
          element_token: `button:${index}`,
          role: "button",
          label: `Control ${index}`,
          actions: ["AXPress"],
        })),
        {
          element_index: 111,
          element_token: "content",
          role,
          label,
          ...(value === undefined ? {} : { value }),
        },
      ],
    },
  };
}

test.each([
  { role: "AXStaticText", label: "Document status", value: "Unsaved changes" },
  { role: "status", label: "Upload complete", value: undefined },
  { role: "textbox", label: "Project name", value: "Draft only" },
])("puts observed $role content before large action lists", ({ role, label, value }) => {
  const state = decisionState({
    task: "Inspect the current document",
    mode: "desktop",
    observation: observed(role, label, value),
    actions: [{ kind: "finish", reason: "Finish", summary: "Done" }],
  });
  expect(state.indexOf(value ?? label)).toBeLessThan(state.indexOf("Control 0"));
  expect(screenContent(observed(role, label, value))).toContain(value ?? label);
});

test("reports observed changes and unchanged content separately from tool success", () => {
  const before = screenContent(observed("AXStaticText", "Document status", "Unsaved changes"));
  const after = screenContent(observed("AXStaticText", "Document status", "Changes saved"));
  expect(contentChange(before, after)).toContain(before);
  expect(contentChange(before, after)).toContain(after);
  expect(contentChange(before, before)).toContain("did not change");
});
