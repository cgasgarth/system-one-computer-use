import type { Window } from "../../../src/agent/contracts.ts";
import type { VariantCase } from "./variant-cases.ts";
import type { VariantWorkspace } from "./variant-workspace.ts";

function localPath(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const url = new URL(value);
  return `${url.pathname}${url.search}`;
}

function variantStateHash(workspace: Readonly<VariantWorkspace>, window: Readonly<Window>): string {
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
    document: workspace.documentBody(workspace.config.document.id),
    projects: workspace.projects(),
    choice: workspace.choiceValue(),
    writes: workspace.writes(),
  };
  return new Bun.CryptoHasher("sha256").update(JSON.stringify(state)).digest("hex");
}

function canonicalVariantStart(input: {
  readonly scenario: Readonly<VariantCase>;
  readonly workspace: Readonly<VariantWorkspace>;
  readonly window: Readonly<Window>;
}): boolean {
  const { scenario, workspace, window } = input;
  const writes = workspace.writes();
  const { config } = workspace;
  if (
    Object.values(writes).some((count) => count !== 0) ||
    workspace.documentBody(config.document.id) !== config.document.initialText ||
    workspace.projects().length > 0 ||
    workspace.choiceValue() !== config.choice.initialValue ||
    window.url !== `${workspace.origin}${scenario.start}`
  ) {
    return false;
  }
  if (scenario.id === "fill-unsaved-draft") {
    return (
      window.elements.some((element) => element.role === "dialog") &&
      window.elements.some(
        (element) => element.label === config.draft.field && element.value === "",
      )
    );
  }
  if (scenario.id === "select-duplicate-label") {
    return window.elements.some((element) => element.role === "combobox");
  }
  return window.elements.some(
    (element) =>
      element.role === "link" &&
      element.label === config.document.title &&
      element.href === `${workspace.origin}/document/${encodeURIComponent(config.document.id)}`,
  );
}

export { canonicalVariantStart, variantStateHash };
