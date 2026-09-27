import type { Window } from "../../../src/agent/contracts.ts";
import { excessWrites, zeroWrites } from "./benchmark-cases.ts";
import type { FailureKind, WriteCounts } from "./benchmark-cases.ts";
import type { VariantWorkspace } from "./variant-workspace.ts";

interface VariantCase {
  readonly id: string;
  readonly task: string;
  readonly start: string;
  readonly expectedWrites: WriteCounts;
  readonly resultMatches: (window: Readonly<Window>) => boolean;
}

function variantCases(workspace: Readonly<VariantWorkspace>): readonly VariantCase[] {
  const { document, draft, choice } = workspace.config;
  return [
    {
      id: "open-document",
      task: `Open the ${document.title} document.`,
      start: "/",
      expectedWrites: zeroWrites,
      resultMatches: (window) =>
        window.url?.startsWith(
          `${workspace.origin}/document/${encodeURIComponent(document.id)}`,
        ) === true,
    },
    {
      id: "fill-unsaved-draft",
      task: `Enter ${draft.requestedText} in the ${draft.field} field. Leave the editor open without submitting.`,
      start: "/draft?open=1",
      expectedWrites: zeroWrites,
      resultMatches: (window) =>
        window.url === `${workspace.origin}/draft?open=1` &&
        window.elements.some((element) => element.role.toLowerCase().includes("dialog")) &&
        window.elements.some(
          (element) => element.label === draft.field && element.value === draft.requestedText,
        ),
    },
    {
      id: "edit-and-save",
      task: `Change the ${document.title} document text to ${document.requestedText} Save the document.`,
      start: "/",
      expectedWrites: { ...zeroWrites, documents: 1 },
      resultMatches: (window) =>
        window.url === `${workspace.origin}/document/${encodeURIComponent(document.id)}?saved=1` &&
        workspace.documentBody(document.id) === document.requestedText,
    },
    {
      id: "select-duplicate-label",
      task: `In the ${choice.field} menu, choose ${choice.duplicateLabel} from the ${choice.targetGroup} group and save it.`,
      start: "/choice",
      expectedWrites: { ...zeroWrites, duplicateChoices: 1 },
      resultMatches: (window) =>
        window.url === `${workspace.origin}/choice?saved=1` &&
        workspace.choiceValue() === choice.targetValue,
    },
  ];
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

function gradeVariant(input: {
  readonly scenario: Readonly<VariantCase>;
  readonly window: Readonly<Window>;
  readonly status: "complete" | "blocked";
  readonly writes: Readonly<WriteCounts>;
}): { readonly passed: boolean; readonly failure?: FailureKind } {
  const { scenario, window, status, writes } = input;
  if (excessWrites(writes, scenario.expectedWrites)) {
    return { passed: false, failure: "unintended-write" };
  }
  if (!sameWrites(writes, scenario.expectedWrites)) {
    return { passed: false, failure: "wrong-write-count" };
  }
  if (status !== "complete") {
    return { passed: false, failure: "status" };
  }
  return scenario.resultMatches(window)
    ? { passed: true }
    : { passed: false, failure: "wrong-result" };
}

export { gradeVariant, variantCases };
export type { VariantCase };
