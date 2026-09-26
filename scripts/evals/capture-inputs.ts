import { loadConfig } from "../../src/app/config.ts";
import { options } from "../../src/agent/options.ts";
import type { Observation } from "../../src/agent/contracts.ts";
import { PlaywrightConnection } from "../../src/computer/playwright/connection.ts";
import { parseSnapshot } from "../../src/computer/playwright/snapshot.ts";
import { closeConnectionPage, parseTabs } from "../../src/computer/playwright/tabs.ts";
import { startWorkspace } from "./workspace.ts";

const config = loadConfig();
const workspace = startWorkspace();
const connection = new PlaywrightConnection(config.PLAYWRIGHT_MCP_EXTENSION_TOKEN);
const cases = [
  { name: "document-open", path: "/", task: "Open the Roadmap Review document.", expected: "Activate Roadmap Review" },
  { name: "new-project", path: "/projects", task: "Create and save a new project named Night QA Project.", expected: "Activate New project" },
  { name: "save-ready", path: "/item/r-8", task: "Save the Roadmap Review document with its current text.", expected: "Activate Save document" },
  { name: "cancel-ready", path: "/projects?open=1&draft=Throwaway%20Draft", task: "Cancel and discard this new project draft without creating it.", expected: "Activate Cancel" },
  { name: "choice", path: "/select-values", task: "Set Priority to High and save it.", expected: "Pick High" },
] as const;
const captured = [];
try {
  await connection.call({ name: "browser_tabs", arguments: { action: "new", url: workspace.origin } });
  await closeConnectionPage(connection);
  for (const scenario of cases) {
    // Each observation comes from the fixture's real Chrome page, without a model action.
    // eslint-disable-next-line no-await-in-loop
    await connection.call({ name: "browser_navigate", arguments: { url: `${workspace.origin}${scenario.path}` } });
    // eslint-disable-next-line no-await-in-loop
    const window = parseSnapshot(await connection.call({ name: "browser_snapshot" }));
    const observation: Observation = {
      desktop: {
        apps: [{ bundle_id: "com.google.Chrome", name: "Google Chrome", pid: 0 }],
        windows: [{ app_name: "Google Chrome", pid: 0, window_id: 0, title: window.window_title }],
      },
      window,
    };
    const input = {
      task: scenario.task,
      mode: "browser" as const,
      observation,
      context: "",
      feedback: "",
      actions: options({ mode: "browser", observation, applications: [] }),
    };
    captured.push({ name: scenario.name, expected: scenario.expected, input });
  }
  await Bun.write("runs/qa/overnight/decision-inputs.json", JSON.stringify(captured), { createPath: true });
  console.log(JSON.stringify(captured.map(({ name, expected, input }) => ({ name, expected, controls: input.observation.window?.elements.length, actions: input.actions.length }))));
} finally {
  try {
    const tabs = parseTabs(await connection.call({ name: "browser_tabs", arguments: { action: "list" } }));
    const owned = tabs.find((tab) => tab.url.startsWith(workspace.origin));
    if (owned !== undefined) {
      await connection.call({ name: "browser_tabs", arguments: { action: "close", index: owned.index } });
    }
  } finally {
    await connection.close();
    await workspace.close();
  }
}
