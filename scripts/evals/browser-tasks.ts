import { createComputer, createModels, loadConfig } from "../../src/app/config.ts";
import { runTask } from "../../src/agent/loop.ts";
import type { Window } from "../../src/agent/contracts.ts";
import type { TaskStep } from "../../src/agent/types.ts";
import type { DecisionModel } from "../../src/models/system-one.ts";
import { startWorkspace } from "./workspace.ts";
import { restrictedBrowser } from "./restricted-browser.ts";
import { fixtureHash, sourceHash } from "./provenance.ts";

const TASK_TIMEOUT_MS = 60_000;
const RERENDER_WAIT_MS = 100;
const config = loadConfig();
const models = createModels(config);
const workspace = startWorkspace();
const browser = restrictedBrowser(createComputer(config, "browser"), workspace.origin);
const runId = Bun.env["EVAL_RUN_ID"] ?? crypto.randomUUID();
const outputDirectory = Bun.env["EVAL_OUTPUT_DIR"] ?? `runs/qa/overnight/evals/${runId}`;
const endpoint = new URL(config.SYSTEM_ONE_URL);
const provenance = {
  runId,
  requestedModel: config.SYSTEM_ONE_MODEL,
  endpoint: { origin: endpoint.origin, path: endpoint.pathname },
  sourceHash: await sourceHash(),
  fixtureHash: await fixtureHash(),
};
interface BrowserCase {
  readonly name: string;
  readonly task: string;
  readonly start: string;
  readonly context: string;
  readonly expectedSaves: number;
  readonly validate: (state: FinalState) => boolean;
}
interface FinalState {
  readonly url: string | undefined;
  readonly dialogOpen: boolean;
  readonly draftValue: string | undefined;
  readonly autumnHeading: boolean;
}
function writeCounts(): {
  readonly documents: number;
  readonly profiles: number;
  readonly projects: number;
  readonly choices: number;
  readonly duplicateChoices: number;
} {
  return {
    documents: workspace.saves(),
    profiles: workspace.profileSaves(),
    projects: workspace.projectSaves(),
    choices: workspace.choiceSaves(),
    duplicateChoices: workspace.duplicateSaves(),
  };
}
function writeDelta(
  before: ReturnType<typeof writeCounts>,
  after: ReturnType<typeof writeCounts>,
): ReturnType<typeof writeCounts> {
  return {
    documents: after.documents - before.documents,
    profiles: after.profiles - before.profiles,
    projects: after.projects - before.projects,
    choices: after.choices - before.choices,
    duplicateChoices: after.duplicateChoices - before.duplicateChoices,
  };
}
const cases: readonly BrowserCase[] = [
  {
    name: "open-document",
    task: "Open the Roadmap Review document.",
    start: "/",
    context: "",
    expectedSaves: 0,
    validate: ({ url }): boolean => url?.startsWith(`${workspace.origin}/item/r-8`) === true,
  },
  {
    name: "edit-and-save",
    task: "Change the Roadmap Review document text to Discuss milestones on Thursday. Save the document.",
    start: "/",
    context: "",
    expectedSaves: 1,
    validate: ({ url }): boolean =>
      url?.startsWith(`${workspace.origin}/item/r-8`) === true &&
      workspace.document("r-8")?.body === "Discuss milestones on Thursday.",
  },
  {
    name: "follow-up",
    task: "Open it again.",
    start: "/item/c-3",
    context: `Previous request (historical context only): Open the Roadmap Review document. Previous target: ${workspace.origin}/item/r-8 titled Roadmap Review. The current request takes priority.`,
    expectedSaves: 0,
    validate: ({ url }): boolean => url?.startsWith(`${workspace.origin}/item/r-8`) === true,
  },
  {
    name: "multi-field-profile",
    task: "On Profile settings, set Display name to QA Operator, Summary to Synthetic test account, Priority to High, turn on Email updates, set Visibility to Private, then save the profile.",
    start: "/profile",
    context: "",
    expectedSaves: 0,
    validate: ({ url }): boolean =>
      url?.startsWith(`${workspace.origin}/profile?saved=1`) === true &&
      workspace.profileSaves() === 1 &&
      JSON.stringify(workspace.profile()) ===
        JSON.stringify({
          displayName: "QA Operator",
          summary: "Synthetic test account",
          priority: "high",
          updates: true,
          visibility: "private",
        }),
  },
  {
    name: "modal-cancel",
    task: "Open the New project dialog, enter Throwaway Draft as the project name, then cancel without creating the project.",
    start: "/projects",
    context: "",
    expectedSaves: 0,
    validate: ({ url }): boolean =>
      url === `${workspace.origin}/projects` &&
      workspace.projects().length === 0 &&
      workspace.projectSaves() === 0 &&
      workspace.cancelledDrafts().length === 1 &&
      workspace.cancelledDrafts()[0] === "Throwaway Draft",
  },
  {
    name: "modal-create",
    task: "Create and save a new project named Night QA Project.",
    start: "/projects",
    context: "",
    expectedSaves: 0,
    validate: ({ url }): boolean =>
      url?.startsWith(`${workspace.origin}/projects?saved=1`) === true &&
      workspace.projects().length === 1 &&
      workspace.projects()[0] === "Night QA Project" &&
      workspace.projectSaves() === 1,
  },
  {
    name: "rerendered-button",
    task: "Click the visible Proceed button on the current page once.",
    start: "/volatile?fault=1",
    context: "",
    expectedSaves: 0,
    validate: ({ url }): boolean =>
      url?.startsWith(`${workspace.origin}/volatile?done=1`) === true &&
      workspace.volatileClicks() === 1,
  },
  {
    name: "read-only-dialog",
    task: "Open the Workspace details dialog and leave it open so I can read it.",
    start: "/help",
    context: "",
    expectedSaves: 0,
    validate: ({ url, dialogOpen }): boolean => url === `${workspace.origin}/help` && dialogOpen,
  },
  {
    name: "prefilled-editor-open",
    task: "Show the New project editor. Leave the editor open without creating a project.",
    start: "/projects?open=1&draft=Existing%20draft",
    context: "",
    expectedSaves: 0,
    validate: ({ url, dialogOpen, draftValue }): boolean =>
      url === `${workspace.origin}/projects?open=1&draft=Existing%20draft` &&
      dialogOpen &&
      draftValue === "Existing draft" &&
      workspace.projectSaves() === 0,
  },
  {
    name: "fill-unsaved-draft",
    task: "Enter Draft Only as the Project name. Leave the editor open and do not create the project.",
    start: "/projects?open=1",
    context: "",
    expectedSaves: 0,
    validate: ({ url, dialogOpen, draftValue }): boolean =>
      url === `${workspace.origin}/projects?open=1` &&
      dialogOpen &&
      draftValue === "Draft Only" &&
      workspace.projectSaves() === 0,
  },
  ...(["button", "tab", "row"] as const).map((kind): BrowserCase => ({
    name: `follow-up-${kind}`,
    task: "Open that plan again.",
    start: `/panels/${kind}`,
    context:
      "Previous request (historical context only): Open Autumn plan. Previous target: Autumn plan. The current request takes priority.",
    expectedSaves: 0,
    validate: ({ url, autumnHeading }): boolean =>
      url === `${workspace.origin}/panels/${kind}` && autumnHeading,
  })),
  {
    name: "long-page-target",
    task: "Open the Final Audit document from this list.",
    start: "/long",
    context: "",
    expectedSaves: 0,
    validate: ({ url }): boolean => url?.startsWith(`${workspace.origin}/item/f-99`) === true,
  },
  {
    name: "select-underlying-value",
    task: "Set Priority to High and save it.",
    start: "/select-values",
    context: "",
    expectedSaves: 0,
    validate: ({ url }): boolean =>
      url === `${workspace.origin}/select-values?saved=1` &&
      workspace.choice() === "high-priority" &&
      workspace.choiceSaves() === 1,
  },
  {
    name: "select-duplicate-label",
    task: "In the Priority menu, choose High from the External group and save it.",
    start: "/select-duplicate",
    context: "",
    expectedSaves: 0,
    validate: ({ url }): boolean =>
      url === `${workspace.origin}/select-duplicate?saved=1` &&
      workspace.duplicateChoice() === "external-high" &&
      workspace.duplicateSaves() === 1,
  },
];
interface Outcome {
  readonly passed: boolean;
  readonly status: "complete" | "blocked" | "error";
  readonly totalMs?: number;
  readonly final?: FinalState;
  readonly error?: string;
}
function finalState(window: Window): FinalState {
  const rawDraftValue = window.elements.find((element) => element.label === "Project name")?.value;
  return {
    url: window.url,
    dialogOpen: window.elements.some((element) => element.role.toLowerCase().includes("dialog")),
    draftValue: typeof rawDraftValue === "string" ? rawDraftValue : undefined,
    autumnHeading: window.elements.some(
      (element) => element.role === "heading" && element.label === "Autumn plan",
    ),
  };
}
function expectedWrites(scenario: BrowserCase): ReturnType<typeof writeCounts> {
  return {
    documents: scenario.expectedSaves,
    profiles: Number(scenario.name === "multi-field-profile"),
    projects: Number(scenario.name === "modal-create"),
    choices: Number(scenario.name === "select-underlying-value"),
    duplicateChoices: Number(scenario.name === "select-duplicate-label"),
  };
}
function writesMatch(
  actual: ReturnType<typeof writeCounts>,
  expected: ReturnType<typeof writeCounts>,
): boolean {
  return (
    actual.documents === expected.documents &&
    actual.profiles === expected.profiles &&
    actual.projects === expected.projects &&
    actual.choices === expected.choices &&
    actual.duplicateChoices === expected.duplicateChoices
  );
}
function exceedsWrites(
  actual: ReturnType<typeof writeCounts>,
  expected: ReturnType<typeof writeCounts>,
): boolean {
  return (
    actual.documents > expected.documents ||
    actual.profiles > expected.profiles ||
    actual.projects > expected.projects ||
    actual.choices > expected.choices ||
    actual.duplicateChoices > expected.duplicateChoices
  );
}
function guardWrites(
  before: ReturnType<typeof writeCounts>,
  expected: ReturnType<typeof writeCounts>,
): void {
  const current = writeDelta(before, writeCounts());
  if (exceedsWrites(current, expected)) {
    throw new Error(
      `QA stopped after an unexpected persistent fixture write: ${JSON.stringify(current)}`,
    );
  }
}
function decisionFor(scenario: BrowserCase): DecisionModel {
  if (scenario.name !== "rerendered-button") {
    return models.decision;
  }
  let injected = false;
  return {
    async choose(input) {
      const choice = await models.decision.choose(input);
      if (
        !injected &&
        choice.action.kind === "click_element" &&
        choice.action.reason.includes("Proceed")
      ) {
        injected = true;
        workspace.triggerRerender();
        await Bun.sleep(RERENDER_WAIT_MS);
        if (!workspace.rerendered()) {
          throw new Error("The fixture did not replace its button before click execution.");
        }
      }
      return choice;
    },
  };
}
async function executeCase(scenario: BrowserCase): Promise<boolean> {
  const startedAt = new Date().toISOString();
  const beforeWrites = writeCounts();
  const allowedWrites = expectedWrites(scenario);
  const trace: TaskStep[] = [];
  let outcome: Outcome = { status: "error", passed: false };
  try {
    await browser.navigate?.(`${workspace.origin}${scenario.start}`);
    const result = await runTask({
      ...models,
      decision: decisionFor(scenario),
      task: scenario.task,
      context: scenario.context,
      preferredSurface: "browser",
      applications: [],
      signal: AbortSignal.timeout(TASK_TIMEOUT_MS),
      computer(mode) {
        if (mode !== "browser") {
          throw new Error("This evaluation only allows its local browser workspace");
        }
        return browser;
      },
      onStep(step) {
        trace.push(step);
        guardWrites(beforeWrites, allowedWrites);
      },
    });
    const final = finalState(await browser.window(0, 0));
    outcome = {
      status: result.status,
      passed:
        result.status === "complete" &&
        writesMatch(writeDelta(beforeWrites, writeCounts()), allowedWrites) &&
        scenario.validate(final),
      totalMs: Math.round(result.totalMs),
      final,
    };
  } catch (error) {
    outcome = {
      status: "error",
      passed: false,
      error: error instanceof Error ? error.message : "Task evaluation failed",
    };
  } finally {
    const afterWrites = writeCounts();
    const writes = writeDelta(beforeWrites, afterWrites);
    const artifact = {
      case: scenario.name,
      task: scenario.task,
      ...provenance,
      startedAt,
      endedAt: new Date().toISOString(),
      beforeWrites,
      afterWrites,
      writeDelta: writes,
      outcome,
      audit: {
        roadmapBody: workspace.document("r-8")?.body,
        profile: workspace.profile(),
        projects: workspace.projects(),
        cancelledDrafts: workspace.cancelledDrafts(),
        volatileClicks: workspace.volatileClicks(),
        rerendered: workspace.rerendered(),
        choice: workspace.choice(),
        duplicateChoice: workspace.duplicateChoice(),
      },
      trace,
    };
    await Bun.write(`${outputDirectory}/${scenario.name}.json`, JSON.stringify(artifact), {
      createPath: true,
    });
    console.log(
      JSON.stringify({ case: scenario.name, ...outcome, steps: trace.length, writeDelta: writes }),
    );
  }
  return outcome.passed;
}
let failed = false;
try {
  await browser.desktop();
  const initial = await browser.window(0, 0);
  if (initial.url !== "about:blank") {
    throw new Error("The evaluation needs a blank task tab; it will not overwrite another page.");
  }
  for (const scenario of cases.filter(
    (item) => Bun.env["EVAL_CASE"] === undefined || item.name === Bun.env["EVAL_CASE"],
  )) {
    // Browser tasks use the same extension session and must run in order.
    // eslint-disable-next-line no-await-in-loop
    const passed = await executeCase(scenario);
    if (!passed) {
      failed = true;
      break;
    }
  }
} finally {
  await browser.close();
  await workspace.close();
}
process.exitCode = Number(failed);
