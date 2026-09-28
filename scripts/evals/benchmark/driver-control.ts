import { CodexChromeComputer } from "../../../src/computer/codex-chrome/computer.ts";
import { cases } from "./benchmark-cases.ts";
import { canonicalStart } from "./benchmark-state.ts";
import { startWorkspace } from "../workspace.ts";

const workspace = startWorkspace();
const browser = new CodexChromeComputer({});
let outcome: object = { passed: false };
try {
  await browser.desktop();
  const blank = await browser.window();
  if (blank.url !== "about:blank") {
    throw new Error("The owned Chrome tab did not start on a blank page.");
  }
  await browser.navigate(`${workspace.origin}/`);
  const before = await browser.window();
  const openCase = cases.find((scenario) => scenario.id === "open-document");
  if (
    openCase === undefined ||
    !canonicalStart({ scenario: openCase, workspace, window: before })
  ) {
    throw new Error("The private Chrome document list is not a canonical start state.");
  }
  const matches = before.elements.filter(
    (element) =>
      element.role === "link" &&
      element.label === "Roadmap Review" &&
      element.href === `${workspace.origin}/item/r-8`,
  );
  const [target] = matches;
  if (matches.length !== 1 || target === undefined) {
    throw new Error("The owned browser tab did not observe one exact Roadmap Review link.");
  }
  await browser.clickElement({
    kind: "click_element",
    pid: before.pid,
    window_id: before.window_id,
    element_token: target.element_token,
    reason: "Open the observed Roadmap Review link",
  });
  const after = await browser.window();
  if (after.url !== `${workspace.origin}/item/r-8`) {
    throw new Error("The private Chrome click did not open the requested document.");
  }
  await browser.navigate(`${workspace.origin}/projects?open=1`);
  const draft = await browser.window();
  const draftCase = cases.find((scenario) => scenario.id === "fill-unsaved-draft");
  if (
    draftCase === undefined ||
    !canonicalStart({ scenario: draftCase, workspace, window: draft })
  ) {
    throw new Error("The private Chrome draft editor is not a canonical start state.");
  }
  const field = draft.elements.find(
    (element) => element.role === "textbox" && element.label === "Project name",
  );
  if (field === undefined) {
    throw new Error("The private Chrome editor did not expose Project name.");
  }
  await browser.typeText({
    kind: "type_text",
    pid: draft.pid,
    window_id: draft.window_id,
    element_token: field.element_token,
    text: "Stale Draft",
    reason: "Test a disposable draft field",
  });
  const filled = await browser.window();
  if (
    !filled.elements.some(
      (element) => element.label === "Project name" && element.value === "Stale Draft",
    )
  ) {
    throw new Error("The private Chrome draft did not receive its test value.");
  }
  workspace.reset();
  await browser.navigate("about:blank");
  await browser.navigate(`${workspace.origin}/projects?open=1`);
  const reset = await browser.window();
  if (!reset.elements.some((element) => element.label === "Project name" && element.value === "")) {
    throw new Error("A fresh private page retained the prior trial's draft value.");
  }
  await browser.navigate("about:blank");
  await browser.navigate(`${workspace.origin}/select-duplicate`);
  const select = await browser.window();
  const selectCase = cases.find((scenario) => scenario.id === "select-duplicate-label");
  if (
    selectCase === undefined ||
    !canonicalStart({ scenario: selectCase, workspace, window: select })
  ) {
    throw new Error("The private Chrome select page is not a canonical start state.");
  }
  outcome = {
    passed: true,
    beforeUrl: before.url,
    afterUrl: after.url,
    targetRole: target.role,
    targetLabel: target.label,
    targetToken: target.element_token,
    draftReset: true,
    canonicalSelect: true,
  };
} catch (error) {
  outcome = { passed: false, error: error instanceof Error ? error.message : "Control failed" };
  process.exitCode = 1;
} finally {
  const cleanup = await Promise.allSettled([browser.close(), workspace.close()]);
  if (cleanup.some((result) => result.status === "rejected")) {
    outcome = { ...outcome, cleanupError: true };
    process.exitCode = 1;
  }
  await Bun.write("runs/benchmark/codex-driver-control.json", JSON.stringify(outcome));
  console.log(JSON.stringify(outcome));
}
