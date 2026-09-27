import { describe, expect, test } from "bun:test";
import { startVariantWorkspace } from "../scripts/evals/benchmark/variant-workspace.ts";
import { zeroWrites } from "../scripts/evals/benchmark/benchmark-cases.ts";

const dummy = {
  document: {
    id: "quartz-1",
    title: "Quartz Memo",
    initialText: "Read the first note.",
    requestedText: "Read the revised note.",
    decoys: ["Copper Notes", "Slate Tasks"],
    editorLabel: "Memo text",
    saveLabel: "Store memo",
  },
  draft: {
    field: "Memo title",
    requestedText: "Pending Memo",
    openLabel: "New memo",
    createLabel: "Create memo",
    cancelLabel: "Leave editor",
  },
  choice: {
    field: "Route",
    initialGroup: "Local",
    targetGroup: "Remote",
    duplicateLabel: "Fast",
    initialValue: "local-fast",
    targetValue: "remote-fast",
    saveLabel: "Store route",
  },
  presentation: {
    documentLayout: "table",
    documentOrder: ["decoy-2", "target", "decoy-1"],
    editorLayout: "fieldset",
    choiceOrder: "target-first",
    choiceButtonFirst: true,
  },
};
describe("generic validation workspace", () => {
  test("changes layout and labels while reset restores every stored effect", async () => {
    const workspace = startVariantWorkspace(dummy);
    try {
      const index = await fetch(workspace.origin).then(async (response) => response.text());
      expect(index.indexOf("Slate Tasks")).toBeLessThan(index.indexOf("Quartz Memo"));
      expect(index).toContain("<table>");
      const choice = await fetch(`${workspace.origin}/choice`).then(async (response) =>
        response.text(),
      );
      expect(choice.indexOf('<optgroup label="Remote">')).toBeLessThan(
        choice.indexOf('<optgroup label="Local">'),
      );
      expect(choice.indexOf("Store route")).toBeLessThan(choice.indexOf("<select"));
      await Promise.all([
        fetch(`${workspace.origin}/save`, {
          method: "POST",
          body: new URLSearchParams({ id: "quartz-1", body: "Read the revised note." }),
        }),
        fetch(`${workspace.origin}/draft`, {
          method: "POST",
          body: new URLSearchParams({ name: "Pending Memo" }),
        }),
        fetch(`${workspace.origin}/choice`, {
          method: "POST",
          body: new URLSearchParams({ choice: "remote-fast" }),
        }),
      ]);
      expect(workspace.writes()).toMatchObject({ documents: 1, projects: 1, duplicateChoices: 1 });
      workspace.reset();
      expect(workspace.writes()).toEqual(zeroWrites);
      expect(workspace.documentBody("quartz-1")).toBe("Read the first note.");
      expect(workspace.choiceValue()).toBe("local-fast");
      expect(workspace.projects()).toHaveLength(0);
    } finally {
      await workspace.close();
    }
  });
});
