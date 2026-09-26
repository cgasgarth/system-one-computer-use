import { loadConfig } from "../../src/app/config.ts";
import { PlaywrightConnection } from "../../src/computer/playwright/connection.ts";
import { closeConnectionPage, parseTabs } from "../../src/computer/playwright/tabs.ts";
import { startWorkspace } from "./workspace.ts";

const config = loadConfig();
const workspace = startWorkspace();
const connection = new PlaywrightConnection(config.PLAYWRIGHT_MCP_EXTENSION_TOKEN);
const evaluation =
  "(element) => ({tagName: element.tagName, type: element.type ?? null, formAssociated: !!element.form, formAction: element.form?.action ?? null, formMethod: element.form?.method ?? null})";
const submitInspection =
  "(element) => { const submit = (element instanceof HTMLButtonElement || element instanceof HTMLInputElement) && element.type === 'submit' && element.form !== null; const method = submit ? (element.formMethod || element.form.method).toLowerCase() : ''; return { formSubmit: submit && method === 'post' }; }";
function reference(snapshot: string, label: string): string {
  const line = snapshot.split("\n").find((entry) => entry.includes(`button "${label}"`));
  const token =
    line === undefined ? undefined : /\[ref=(?<token>[^\]]+)\]/u.exec(line)?.groups?.["token"];
  if (token === undefined) {
    throw new Error(`Button ${label} was absent from the fixture snapshot.`);
  }
  return token;
}
async function probe(label: string, snapshot: string): Promise<string> {
  return connection.call({
    name: "browser_evaluate",
    arguments: { element: label, target: reference(snapshot, label), function: evaluation },
  });
}
async function probeSubmit(label: string, snapshot: string): Promise<string> {
  return connection.call({
    name: "browser_evaluate",
    arguments: { element: label, target: reference(snapshot, label), function: submitInspection },
  });
}
try {
  await connection.call({
    name: "browser_tabs",
    arguments: { action: "new", url: `${workspace.origin}/item/r-8` },
  });
  await closeConnectionPage(connection);
  const documentSnapshot = await connection.call({ name: "browser_snapshot" });
  const save = await probe("Save document", documentSnapshot);
  const saveSubmit = await probeSubmit("Save document", documentSnapshot);
  await connection.call({
    name: "browser_navigate",
    arguments: { url: `${workspace.origin}/projects?open=1&draft=Existing%20draft` },
  });
  const modalSnapshot = await connection.call({ name: "browser_snapshot" });
  const newProject = await probe("New project", modalSnapshot);
  const cancel = await probe("Cancel", modalSnapshot);
  const create = await probe("Create project", modalSnapshot);
  const createSubmit = await probeSubmit("Create project", modalSnapshot);
  const cancelSubmit = await probeSubmit("Cancel", modalSnapshot);
  await connection.call({
    name: "browser_navigate",
    arguments: { url: `${workspace.origin}/search-get` },
  });
  const searchSnapshot = await connection.call({ name: "browser_snapshot" });
  const searchSubmit = await probeSubmit("Search", searchSnapshot);
  console.log(
    JSON.stringify({
      save,
      newProject,
      cancel,
      create,
      saveSubmit,
      createSubmit,
      cancelSubmit,
      searchSubmit,
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
