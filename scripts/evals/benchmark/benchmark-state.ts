import { isEditableElement } from "../../../src/agent/contracts.ts";
import type { Window } from "../../../src/agent/contracts.ts";
import type { Workspace } from "../workspace.ts";
import { writeCounts } from "./benchmark-cases.ts";
import type { BenchmarkCase } from "./benchmark-cases.ts";

function localPath(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const url = new URL(value);
  return `${url.pathname}${url.search}`;
}
function initialStateHash(workspace: Readonly<Workspace>, window: Readonly<Window>): string {
  const state = {
    page: localPath(window.url),
    title: window.window_title,
    controls: window.elements.map((element) => ({
      role: element.role,
      label: element.label,
      value: element.value,
      href: localPath(element.href),
      enabled: element.enabled,
      selected: element.selected,
    })),
    document: workspace.document("r-8")?.body,
    profile: workspace.profile(),
    projects: workspace.projects(),
    choice: workspace.choice(),
    duplicateChoice: workspace.duplicateChoice(),
    writes: writeCounts(workspace),
  };
  return new Bun.CryptoHasher("sha256").update(JSON.stringify(state)).digest("hex");
}
function canonicalStart(input: {
  readonly scenario: Readonly<BenchmarkCase>;
  readonly workspace: Readonly<Workspace>;
  readonly window: Readonly<Window>;
}): boolean {
  const { scenario, workspace, window } = input;
  const profile = workspace.profile();
  const writes = writeCounts(workspace);
  const noWrites = Object.values(writes).every((count) => count === 0);
  const freshData =
    workspace.document("r-8")?.body === "Discuss milestones on Tuesday." &&
    workspace.projects().length === 0 &&
    profile.displayName === "Initial name" &&
    profile.summary === "Initial summary" &&
    profile.priority === "normal" &&
    !profile.updates &&
    profile.visibility === "team" &&
    workspace.choice() === "low-priority" &&
    workspace.duplicateChoice() === "internal-high";
  if (!noWrites || !freshData || window.url !== `${workspace.origin}${scenario.start}`) {
    return false;
  }
  if (scenario.id === "fill-unsaved-draft") {
    // Codex AX exposes this native dialog as a container and omits empty values.
    return window.elements.some(
      (element) =>
        isEditableElement(element) &&
        element.label === "Project name" &&
        (element.value === "" || element.value === undefined),
    );
  }
  if (scenario.id === "select-duplicate-label") {
    return window.elements.some(
      (element) => element.role === "combobox" && element.value === "Internal: High",
    );
  }
  return window.elements.some(
    (element) =>
      element.role === "link" &&
      element.label === "Roadmap Review" &&
      element.href === `${workspace.origin}/item/r-8`,
  );
}
export { canonicalStart, initialStateHash };
