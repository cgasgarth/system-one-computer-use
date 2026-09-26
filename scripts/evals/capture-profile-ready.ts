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
function reference(snapshot: string, label: string): string {
  const line = snapshot.split("\n").find((entry) => entry.includes(`textbox "${label}"`));
  const token =
    line === undefined ? undefined : /\[ref=(?<token>[^\]]+)\]/u.exec(line)?.groups?.["token"];
  if (token === undefined) {
    throw new Error(`Field ${label} was absent from the fixture snapshot.`);
  }
  return token;
}
try {
  await connection.call({
    name: "browser_tabs",
    arguments: { action: "new", url: `${workspace.origin}/profile` },
  });
  await closeConnectionPage(connection);
  const first = await connection.call({ name: "browser_snapshot" });
  await connection.call({
    name: "browser_type",
    arguments: { target: reference(first, "Display name"), text: "QA Operator" },
  });
  const second = await connection.call({ name: "browser_snapshot" });
  await connection.call({
    name: "browser_type",
    arguments: { target: reference(second, "Summary"), text: "Synthetic test account" },
  });
  const window = parseSnapshot(await connection.call({ name: "browser_snapshot" }));
  const observation: Observation = {
    desktop: {
      apps: [{ bundle_id: "com.google.Chrome", name: "Google Chrome", pid: 0 }],
      windows: [{ app_name: "Google Chrome", pid: 0, window_id: 0, title: window.window_title }],
    },
    window,
  };
  const input = {
    task: "On Profile settings, set Display name to QA Operator, Summary to Synthetic test account, Priority to High, turn on Email updates, set Visibility to Private, then save the profile.",
    mode: "browser" as const,
    observation,
    context: "",
    feedback: "",
    actions: options({ mode: "browser", observation, applications: [] }),
  };
  await Bun.write("runs/qa/overnight/profile-ready-input.json", JSON.stringify(input), {
    createPath: true,
  });
  console.log(
    JSON.stringify({
      controls: window.elements
        .filter((element) => ["textbox", "combobox", "checkbox", "radio"].includes(element.role))
        .map(({ role, label, value, selected }) => ({ role, label, value, selected })),
      actions: input.actions.length,
      profileSaves: workspace.profileSaves(),
    }),
  );
} finally {
  try {
    const tabs = parseTabs(
      await connection.call({ name: "browser_tabs", arguments: { action: "list" } }),
    );
    const owned = tabs.find((tab) => tab.url.startsWith(workspace.origin));
    if (owned !== undefined) {
      await connection.call({
        name: "browser_tabs",
        arguments: { action: "close", index: owned.index },
      });
    }
  } finally {
    await connection.close();
    await workspace.close();
  }
}
