import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startVariantWorkspace } from "../scripts/evals/benchmark/variant-workspace.ts";
import { createBenchmarkSuite } from "../scripts/evals/benchmark/benchmark-suite.ts";
import { cases, zeroWrites } from "../scripts/evals/benchmark/benchmark-cases.ts";
import { gradeVariant, variantCases } from "../scripts/evals/benchmark/variant-cases.ts";
import {
  canonicalVariantStart,
  variantStateHash,
} from "../scripts/evals/benchmark/variant-state.ts";
import type { Window } from "../src/agent/contracts.ts";

const SHA256_HEX_LENGTH = 64;
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
// oxlint-disable-next-line max-lines-per-function -- Independent fixture checks share one synthetic configuration.
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
  test("uses changed task terms and rejects closing an unsaved editor", async () => {
    const workspace = startVariantWorkspace(dummy);
    try {
      const scenarios = variantCases(workspace);
      expect(scenarios.map((scenario) => scenario.id)).toEqual([
        "open-document",
        "fill-unsaved-draft",
        "edit-and-save",
        "select-duplicate-label",
      ]);
      const [, draft] = scenarios;
      if (draft === undefined) {
        throw new Error("Missing dummy draft case");
      }
      expect(draft.task).toContain("Pending Memo");
      expect(draft.task).toContain("Memo title");
      await fetch(`${workspace.origin}/draft/cancel`, { method: "POST" });
      expect(workspace.writes().cancelledDrafts).toBe(1);
      const window: Window = {
        app_name: "Google Chrome",
        elements: [],
        pid: 0,
        snapshot_id: "dummy",
        window_id: 0,
        window_title: "Draft editor",
        url: `${workspace.origin}/draft?open=1`,
      };
      expect(
        gradeVariant({
          scenario: draft,
          window,
          status: "complete",
          writes: workspace.writes(),
        }),
      ).toEqual({ passed: false, failure: "unintended-write" });
    } finally {
      await workspace.close();
    }
  });
  test("binds a canonical start and stable reset hash to the variant", async () => {
    const workspace = startVariantWorkspace(dummy);
    try {
      const [open] = variantCases(workspace);
      if (open === undefined) {
        throw new Error("Missing dummy document case");
      }
      const window: Window = {
        app_name: "Google Chrome",
        elements: [
          {
            element_index: 0,
            element_token: "first-token",
            role: "link",
            label: "Quartz Memo",
            href: `${workspace.origin}/document/quartz-1`,
          },
        ],
        pid: 0,
        snapshot_id: "first-snapshot",
        window_id: 0,
        window_title: "Documents",
        url: `${workspace.origin}/`,
      };
      expect(canonicalVariantStart({ scenario: open, workspace, window })).toBe(true);
      const originalHash = variantStateHash(workspace, window);
      await fetch(`${workspace.origin}/save`, {
        method: "POST",
        body: new URLSearchParams({ id: "quartz-1", body: "Read the revised note." }),
      });
      expect(canonicalVariantStart({ scenario: open, workspace, window })).toBe(false);
      workspace.reset();
      const [link] = window.elements;
      if (link === undefined) {
        throw new Error("Missing dummy document link");
      }
      const rotatedWindow: Window = {
        ...window,
        snapshot_id: "second-snapshot",
        elements: [{ ...link, element_token: "second-token" }],
      };
      expect(canonicalVariantStart({ scenario: open, workspace, window: rotatedWindow })).toBe(
        true,
      );
      expect(variantStateHash(workspace, rotatedWindow)).toBe(originalHash);
    } finally {
      await workspace.close();
    }
  });
  test("binds changed tasks to the existing serial trial runner", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "s1-variant-test-"));
    const file = path.join(directory, "variant.json");
    await Bun.write(file, JSON.stringify(dummy));
    const suite = await createBenchmarkSuite(cases, file);
    try {
      expect(suite.executions.map((scenario) => scenario.id)).toEqual(
        cases.map((scenario) => scenario.id),
      );
      expect(
        suite.variantMetadata?.tasks.find((task) => task.id === "open-document")?.task,
      ).toContain("Quartz Memo");
      expect(suite.variantMetadata?.configSha256).toHaveLength(SHA256_HEX_LENGTH);
    } finally {
      await suite.close();
      await rm(directory, { recursive: true });
    }
  });
});
