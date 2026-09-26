import { createComputer, loadConfig } from "../../src/app/config.ts";
import { startWorkspace } from "./workspace.ts";

const workspace = startWorkspace();
const browser = createComputer(loadConfig(), "browser");
try {
  await browser.desktop();
  const initial = await browser.window(0, 0);
  if (initial.url !== "about:blank") {
    throw new Error("The driver probe needs a blank test tab.");
  }
  await browser.navigate?.(`${workspace.origin}/select-values`);
  const simpleBefore = await browser.window(0, 0);
  const high = simpleBefore.elements.find(
    (element) => element.role === "option" && element.label === "High",
  );
  if (high?.actions?.includes("AXPick") !== true) {
    throw new Error("The High option was not exposed as a pickable control.");
  }
  await browser.clickElement({
    kind: "click_element",
    pid: 0,
    window_id: 0,
    element_token: high.element_token,
    operation: "pick",
    reason: "Pick High",
  });
  const simpleAfter = await browser.window(0, 0);
  const simpleOptions = simpleAfter.elements
    .filter((element) => element.role === "option")
    .map((element) => ({ label: element.label, selected: element.selected }));
  await browser.navigate?.(`${workspace.origin}/select-duplicate`);
  const duplicateBefore = await browser.window(0, 0);
  const duplicates = duplicateBefore.elements.filter((element) => element.role === "option");
  const [, external] = duplicates;
  if (external?.actions?.includes("AXPick") !== true) {
    throw new Error(
      `The second High option was not pickable: ${JSON.stringify(duplicates.map(({ label, actions }) => ({ label, actions })))}`,
    );
  }
  await browser.clickElement({
    kind: "click_element",
    pid: 0,
    window_id: 0,
    element_token: external.element_token,
    operation: "pick",
    reason: "Pick External High",
  });
  const duplicateAfter = await browser.window(0, 0);
  const duplicateOptions = duplicateAfter.elements
    .filter((element) => element.role === "option")
    .map((element) => ({ label: element.label, selected: element.selected }));
  const [simpleLow, simpleHigh] = simpleOptions;
  const [duplicateInternal, duplicateExternal] = duplicateOptions;
  const passed =
    simpleLow?.selected === false &&
    simpleHigh?.selected === true &&
    duplicateInternal?.selected === false &&
    duplicateExternal?.selected === true &&
    workspace.choiceSaves() === 0 &&
    workspace.duplicateSaves() === 0;
  console.log(
    JSON.stringify({
      passed,
      simpleOptions,
      duplicateOptions,
      savedChoice: workspace.choice(),
      savedDuplicateChoice: workspace.duplicateChoice(),
      choiceSaves: workspace.choiceSaves(),
      duplicateSaves: workspace.duplicateSaves(),
      url: duplicateAfter.url,
    }),
  );
  process.exitCode = Number(!passed);
} finally {
  await browser.close();
  await workspace.close();
}
