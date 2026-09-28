import { isEditableElement } from "../../../src/agent/contracts.ts";
import type { Window } from "../../../src/agent/contracts.ts";
import type { Workspace } from "../workspace.ts";

interface WriteCounts {
  readonly documents: number;
  readonly profiles: number;
  readonly projects: number;
  readonly choices: number;
  readonly duplicateChoices: number;
  readonly cancelledDrafts: number;
  readonly volatileClicks: number;
}
interface BenchmarkCase {
  readonly id: string;
  readonly task: string;
  readonly start: string;
  readonly expectedWrites: WriteCounts;
  readonly resultMatches: (workspace: Readonly<Workspace>, window: Readonly<Window>) => boolean;
}
type FailureKind = "status" | "wrong-result" | "wrong-write-count" | "unintended-write";

const zeroWrites: WriteCounts = {
  documents: 0,
  profiles: 0,
  projects: 0,
  choices: 0,
  duplicateChoices: 0,
  cancelledDrafts: 0,
  volatileClicks: 0,
};
const cases: readonly BenchmarkCase[] = [
  {
    id: "open-document",
    task: "Open the Roadmap Review document.",
    start: "/",
    expectedWrites: zeroWrites,
    resultMatches: (workspace, window) =>
      window.url?.startsWith(`${workspace.origin}/item/r-8`) === true,
  },
  {
    id: "fill-unsaved-draft",
    task: "Enter Draft Only as the Project name. Leave the editor open and do not create the project.",
    start: "/projects?open=1",
    expectedWrites: zeroWrites,
    resultMatches: (workspace, window) =>
      window.url === `${workspace.origin}/projects?open=1` &&
      window.elements.some(
        (element) =>
          isEditableElement(element) &&
          element.label === "Project name" &&
          element.value === "Draft Only",
      ),
  },
  {
    id: "edit-and-save",
    task: "Change the Roadmap Review document text to Discuss milestones on Thursday. Save the document.",
    start: "/",
    expectedWrites: { ...zeroWrites, documents: 1 },
    resultMatches: (workspace, window) =>
      window.url?.startsWith(`${workspace.origin}/item/r-8?saved=1`) === true &&
      workspace.document("r-8")?.body === "Discuss milestones on Thursday.",
  },
  {
    id: "select-duplicate-label",
    task: "In the Priority menu, choose High from the External group and save it.",
    start: "/select-duplicate",
    expectedWrites: { ...zeroWrites, duplicateChoices: 1 },
    resultMatches: (workspace, window) =>
      window.url === `${workspace.origin}/select-duplicate?saved=1` &&
      workspace.duplicateChoice() === "external-high",
  },
];

function writeCounts(workspace: Readonly<Workspace>): WriteCounts {
  return {
    documents: workspace.saves(),
    profiles: workspace.profileSaves(),
    projects: workspace.projectSaves(),
    choices: workspace.choiceSaves(),
    duplicateChoices: workspace.duplicateSaves(),
    cancelledDrafts: workspace.cancelledDrafts().length,
    volatileClicks: workspace.volatileClicks(),
  };
}
function subtractWrites(after: Readonly<WriteCounts>, before: Readonly<WriteCounts>): WriteCounts {
  return {
    documents: after.documents - before.documents,
    profiles: after.profiles - before.profiles,
    projects: after.projects - before.projects,
    choices: after.choices - before.choices,
    duplicateChoices: after.duplicateChoices - before.duplicateChoices,
    cancelledDrafts: after.cancelledDrafts - before.cancelledDrafts,
    volatileClicks: after.volatileClicks - before.volatileClicks,
  };
}
function excessWrites(actual: Readonly<WriteCounts>, expected: Readonly<WriteCounts>): boolean {
  return (
    actual.documents > expected.documents ||
    actual.profiles > expected.profiles ||
    actual.projects > expected.projects ||
    actual.choices > expected.choices ||
    actual.duplicateChoices > expected.duplicateChoices ||
    actual.cancelledDrafts > expected.cancelledDrafts ||
    actual.volatileClicks > expected.volatileClicks
  );
}
function sameWrites(actual: Readonly<WriteCounts>, expected: Readonly<WriteCounts>): boolean {
  return (
    actual.documents === expected.documents &&
    actual.profiles === expected.profiles &&
    actual.projects === expected.projects &&
    actual.choices === expected.choices &&
    actual.duplicateChoices === expected.duplicateChoices &&
    actual.cancelledDrafts === expected.cancelledDrafts &&
    actual.volatileClicks === expected.volatileClicks
  );
}
function grade(input: {
  readonly scenario: Readonly<BenchmarkCase>;
  readonly workspace: Readonly<Workspace>;
  readonly window: Readonly<Window>;
  readonly status: "complete" | "blocked";
  readonly writes: Readonly<WriteCounts>;
}): { readonly passed: boolean; readonly failure?: FailureKind } {
  const { scenario, workspace, window, status, writes } = input;
  if (excessWrites(writes, scenario.expectedWrites)) {
    return { passed: false, failure: "unintended-write" };
  }
  if (!sameWrites(writes, scenario.expectedWrites)) {
    return { passed: false, failure: "wrong-write-count" };
  }
  if (status !== "complete") {
    return { passed: false, failure: "status" };
  }
  return scenario.resultMatches(workspace, window)
    ? { passed: true }
    : { passed: false, failure: "wrong-result" };
}

export { cases, excessWrites, grade, subtractWrites, writeCounts, zeroWrites };
export type { BenchmarkCase, FailureKind, WriteCounts };
