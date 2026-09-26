import { createComputer, createModels, loadConfig } from "../../src/app/config.ts";
import { runTask } from "../../src/agent/loop.ts";
import type { Window } from "../../src/agent/contracts.ts";
import type { TaskStep } from "../../src/agent/types.ts";
import type { ManagedComputer } from "../../src/computer/types.ts";

const MAIN_PAGE = "https://en.wikipedia.org/wiki/Main_Page";
const TASK_TIMEOUT_MS = 90_000;
const MAX_SEARCH_CHARS = 80;
function allowed(url: string): boolean {
  if (url === "about:blank") {
    return true;
  }
  const parsed = new URL(url);
  if (parsed.origin !== "https://en.wikipedia.org") {
    return false;
  }
  if (parsed.pathname === "/w/index.php") {
    return (
      parsed.searchParams.get("search")?.toLowerCase() === "chicago" &&
      !parsed.searchParams.has("action")
    );
  }
  return parsed.pathname.startsWith("/wiki/") && !decodeURIComponent(parsed.pathname).includes(":");
}
function readOnlyWikipedia(computer: ManagedComputer): ManagedComputer {
  let observed: Window | undefined = undefined;
  let searchArmed = false;
  return {
    desktop: async () => computer.desktop(),
    async window(pid, windowId) {
      const window = await computer.window(pid, windowId);
      if (window.url !== undefined && !allowed(window.url)) {
        throw new Error("The browser left the allowed Wikipedia reading area.");
      }
      observed = window;
      return window;
    },
    launchApp: () => {
      throw new Error("Native apps are outside this read-only evaluation.");
    },
    async clickElement(action) {
      const target = observed?.elements.find(
        (element) => element.element_token === action.element_token,
      );
      if (target?.role !== "link" || target.href === undefined || !allowed(target.href)) {
        throw new Error("Only Wikipedia article links are allowed in this evaluation.");
      }
      await computer.clickElement(action);
    },
    inspectClick: computer.inspectClick.bind(computer),
    async typeText(action) {
      const target = observed?.elements.find(
        (element) => element.element_token === action.element_token,
      );
      if (
        target?.role !== "searchbox" &&
        !(target?.role === "textbox" && target.label?.toLowerCase().includes("search") === true)
      ) {
        throw new Error("Only the Wikipedia search field can receive text.");
      }
      if (
        !action.text.toLowerCase().includes("chicago") ||
        action.text.length > MAX_SEARCH_CHARS ||
        !/^[A-Za-z ,.-]+$/u.test(action.text)
      ) {
        throw new Error("This evaluation only permits a short public Chicago search phrase.");
      }
      searchArmed = true;
      await computer.typeText(action);
    },
    async pressKey(action) {
      if (
        !searchArmed ||
        !["return", "enter"].includes(action.key) ||
        action.modifiers.length > 0
      ) {
        throw new Error("Only submitting the Chicago search is allowed.");
      }
      searchArmed = false;
      await computer.pressKey(action);
    },
    navigate: async (url) => {
      if (!allowed(url)) {
        throw new Error("The requested URL is outside the allowed Wikipedia reading area.");
      }
      await computer.navigate?.(url);
    },
    bookmark: async () => {
      if (computer.bookmark === undefined) {
        throw new Error("Browser bookmark unavailable.");
      }
      return computer.bookmark();
    },
    close: async () => computer.close(),
  };
}
const config = loadConfig();
const models = createModels(config);
const browser = readOnlyWikipedia(createComputer(config, "browser"));
const trace: TaskStep[] = [];
try {
  await browser.desktop();
  const initial = await browser.window(0, 0);
  if (initial.url !== "about:blank") {
    throw new Error("The read-only evaluation needs a new blank tab.");
  }
  await browser.navigate?.(MAIN_PAGE);
  const result = await runTask({
    ...models,
    task: "From Wikipedia's Main Page, find and open the Chicago article.",
    context: "",
    preferredSurface: "browser",
    applications: [],
    signal: AbortSignal.timeout(TASK_TIMEOUT_MS),
    computer(mode) {
      if (mode !== "browser") {
        throw new Error("Native tools are outside this read-only evaluation.");
      }
      return browser;
    },
    onStep(step) {
      trace.push(step);
    },
  });
  const final = await browser.window(0, 0);
  const passed =
    result.status === "complete" &&
    final.url === "https://en.wikipedia.org/wiki/Chicago" &&
    final.elements.some((element) => element.role === "heading" && element.label === "Chicago");
  const summary = {
    passed,
    status: result.status,
    steps: trace.length,
    totalMs: Math.round(result.totalMs),
    url: final.url,
  };
  console.log(JSON.stringify(summary));
  await Bun.write(
    "runs/qa/overnight/wikipedia-readonly.json",
    JSON.stringify({ ...summary, trace }),
    { createPath: true },
  );
  process.exitCode = Number(!passed);
} finally {
  await browser.close();
}
