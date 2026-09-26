/* eslint-disable typescript/prefer-readonly-parameter-types -- The local fixture mutates isolated in-memory counters and form state. */
import { z } from "zod";

const SEE_OTHER = 303;
interface Document {
  readonly title: string;
  body: string;
}
const profileInput = z.object({
  displayName: z.string(),
  summary: z.string(),
  priority: z.string(),
  updates: z.boolean(),
  visibility: z.string(),
});
type Profile = z.infer<typeof profileInput>;
interface Workspace {
  readonly origin: string;
  readonly document: (id: string) => Readonly<Document> | undefined;
  readonly saves: () => number;
  readonly profile: () => Readonly<Profile>;
  readonly profileSaves: () => number;
  readonly projects: () => readonly string[];
  readonly projectSaves: () => number;
  readonly cancelledDrafts: () => readonly string[];
  readonly volatileClicks: () => number;
  readonly triggerRerender: () => void;
  readonly rerendered: () => boolean;
  readonly choice: () => string;
  readonly choiceSaves: () => number;
  readonly duplicateChoice: () => string;
  readonly duplicateSaves: () => number;
  readonly close: () => Promise<void>;
}
interface WorkspaceState {
  readonly documents: Map<string, Document>;
  readonly projects: string[];
  readonly cancelledDrafts: string[];
  profile: Profile;
  saveCount: number;
  profileSaveCount: number;
  projectSaveCount: number;
  volatileClickCount: number;
  volatileVersion: number;
  volatileRerendered: boolean;
  choice: string;
  choiceSaveCount: number;
  duplicateChoice: string;
  duplicateSaveCount: number;
}
const documentInput = z.object({ id: z.string(), body: z.string() });
function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
}
function page(title: string, content: string): Response {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>body{font:18px system-ui;max-width:760px;margin:60px auto}textarea{display:block;width:100%;height:180px;margin:20px 0}button,input,textarea{font:inherit;padding:12px}nav{margin:20px 0}</style></head><body><h1>Local test workspace</h1><nav><a href="/">Documents</a></nav>${content}</body></html>`,
    { headers: { "content-type": "text/html" } },
  );
}
function profilePage(state: WorkspaceState, url: URL): Response {
  const { profile } = state;
  return page(
    "Profile settings",
    `<h2>Profile settings</h2>${url.searchParams.has("saved") ? '<p role="status">Profile saved.</p>' : ""}<form method="post" action="/profile">
    <label>Display name <input name="displayName" value="${escapeHtml(profile.displayName)}"></label>
    <label>Summary <textarea name="summary">${escapeHtml(profile.summary)}</textarea></label>
    <label>Priority <select name="priority"><option value="low" ${profile.priority === "low" ? "selected" : ""}>Low</option><option value="normal" ${profile.priority === "normal" ? "selected" : ""}>Normal</option><option value="high" ${profile.priority === "high" ? "selected" : ""}>High</option></select></label>
    <label><input type="checkbox" name="updates" ${profile.updates ? "checked" : ""}> Email updates</label>
    <fieldset><legend>Visibility</legend><label><input type="radio" name="visibility" value="team" ${profile.visibility === "team" ? "checked" : ""}> Team</label><label><input type="radio" name="visibility" value="private" ${profile.visibility === "private" ? "checked" : ""}> Private</label></fieldset>
    <button>Save profile</button></form>`,
  );
}
function projectsPage(state: WorkspaceState, url: URL): Response {
  const draft = escapeHtml(url.searchParams.get("draft") ?? "");
  const open = url.searchParams.has("open");
  return page(
    "Projects",
    `<h2>Projects</h2>${url.searchParams.has("saved") ? '<p role="status">Project created.</p>' : ""}<ul>${state.projects.map((name) => `<li>${escapeHtml(name)}</li>`).join("")}</ul>
    <button type="button" onclick="document.getElementById('new-project').showModal()">New project</button>
      <dialog id="new-project"><h3>Create project</h3><form method="post" action="/projects"><label>Project name <input name="name" value="${draft}" required></label><button type="button" onclick="fetch('/projects/cancel',{method:'POST',body:new URLSearchParams({name:this.form.elements.name.value})});this.closest('dialog').close()">Cancel</button><button>Create project</button></form></dialog>${open ? "<script>document.getElementById('new-project').showModal()</script>" : ""}`,
  );
}
function volatilePage(url: URL): Response {
  const delay = Number(url.searchParams.get("delay") ?? "350");
  const rerender = url.searchParams.has("fault")
    ? "setInterval(async () => { const version = await (await fetch('/volatile/version')).text(); if (version === '2' && document.getElementById('version')?.textContent === 'Version 1') { document.getElementById('version').textContent = 'Version 2'; document.getElementById('proceed').outerHTML = '<button id=\"proceed\" type=\"submit\">Proceed</button>'; await fetch('/volatile/replaced', {method:'POST'}); } }, 20);"
    : `setTimeout(() => { document.getElementById('version').textContent = 'Version 2'; document.getElementById('proceed').outerHTML = '<button id="proceed" type="submit">Proceed</button>'; }, ${delay});`;
  return page(
    "Volatile controls",
    `<h2>Volatile controls</h2>${url.searchParams.has("done") ? '<p role="status">Proceed completed.</p>' : `<p id="version">Version 1</p><form method="post" action="/volatile"><button id="proceed" type="submit">Proceed</button></form><script>${rerender}</script>`}`,
  );
}
function helpPage(): Response {
  return page(
    "Workspace help",
    `<h2>Workspace help</h2><button type="button" onclick="document.getElementById('details').showModal()">Show details</button><dialog id="details" aria-label="Workspace details"><h3>Workspace details</h3><p>This local workspace stores synthetic test data.</p><button type="button" onclick="this.closest('dialog').close()">Close</button></dialog>`,
  );
}
function panelPage(kind: string): Response {
  const heading = `<h2>Plans</h2><section id="selected"><h3>Winter plan</h3><p>Snow preparation.</p></section>`;
  const activate =
    "document.getElementById('selected').innerHTML='<h3>Autumn plan</h3><p>Harvest schedule.</p>'";
  if (kind === "button") {
    return page(
      "Plans",
      `${heading}<button type="button" onclick="${activate}">Autumn plan</button>`,
    );
  }
  if (kind === "tab") {
    return page(
      "Plans",
      `${heading}<div role="tablist" aria-label="Plans"><button role="tab" aria-selected="false" onclick="${activate};this.setAttribute('aria-selected','true')">Autumn plan</button></div>`,
    );
  }
  return page(
    "Plans",
    `${heading}<table><tbody><tr tabindex="0" onclick="${activate}" onkeydown="if(event.key==='Enter')this.click()"><td>Autumn plan</td><td>Harvest schedule</td></tr></tbody></table>`,
  );
}
function longPage(): Response {
  const decoys = Array.from(
    { length: 120 },
    (_unused, index) => `<li><a href="/item/c-3?decoy=${index}">Archive ${index + 1}</a></li>`,
  ).join("");
  return page(
    "Large document list",
    `<h2>Large document list</h2><ul>${decoys}<li><a href="/item/f-99">Final Audit</a></li></ul>`,
  );
}
function selectPage(url: URL, selected: string): Response {
  return page(
    "Priority choice",
    `<h2>Priority choice</h2>${url.searchParams.has("saved") ? '<p role="status">Priority saved.</p>' : ""}<form method="post" action="/select-values"><label>Priority <select name="priority"><option value="low-priority" ${selected === "low-priority" ? "selected" : ""}>Low</option><option value="high-priority" ${selected === "high-priority" ? "selected" : ""}>High</option></select></label><button>Save priority</button></form>`,
  );
}
function duplicateSelectPage(url: URL, selected: string): Response {
  return page(
    "Grouped priority",
    `<h2>Grouped priority</h2>${url.searchParams.has("saved") ? '<p role="status">Grouped priority saved.</p>' : ""}<form method="post" action="/select-duplicate"><label>Priority <select name="priority"><optgroup label="Internal"><option value="internal-high" ${selected === "internal-high" ? "selected" : ""}>High</option></optgroup><optgroup label="External"><option value="external-high" ${selected === "external-high" ? "selected" : ""}>High</option></optgroup></select></label><button>Save priority</button></form>`,
  );
}
function getSearchPage(): Response {
  return page(
    "Local search",
    `<h2>Local search</h2><form method="get" action="/search-get"><label>Search <input name="query"></label><button>Search</button></form>`,
  );
}
function documentsPage(state: WorkspaceState, url: URL): Response {
  if (url.pathname === "/search-get") {
    return getSearchPage();
  }
  if (url.pathname === "/") {
    return page(
      "Documents",
      `<h2>Documents</h2><p>Select a document to read or edit.</p><ul>${[...state.documents].map(([key, value]) => `<li><a href="/item/${key}">${value.title}</a></li>`).join("")}</ul>`,
    );
  }
  const id = url.pathname.slice("/item/".length);
  const document = url.pathname.startsWith("/item/") ? state.documents.get(id) : undefined;
  if (document === undefined) {
    return page("Not found", "<h2>No document at this address.</h2>");
  }
  return page(
    document.title,
    `<h2>${document.title}</h2><p>Saved text: ${escapeHtml(document.body)}</p>${url.searchParams.has("saved") ? '<p role="status">Changes saved.</p>' : ""}<form method="post" action="/save"><input type="hidden" name="id" value="${id}"><label>Document text<textarea name="body" aria-label="Document text">${escapeHtml(document.body)}</textarea></label><button>Save document</button></form>`,
  );
}
async function saveDocument(state: WorkspaceState, request: Request, url: URL): Promise<Response> {
  const input = documentInput.parse(Object.fromEntries(await request.formData()));
  const document = state.documents.get(input.id);
  if (document === undefined) {
    return new Response("Document missing", { status: 404 });
  }
  document.body = input.body;
  state.saveCount += 1;
  return Response.redirect(new URL(`/item/${input.id}?saved=1`, url), SEE_OTHER);
}
async function saveProfile(state: WorkspaceState, request: Request, url: URL): Promise<Response> {
  const data = await request.formData();
  state.profile = profileInput.parse({
    displayName: data.get("displayName"),
    summary: data.get("summary"),
    priority: data.get("priority"),
    updates: data.has("updates"),
    visibility: data.get("visibility"),
  });
  state.profileSaveCount += 1;
  return Response.redirect(new URL("/profile?saved=1", url), SEE_OTHER);
}
async function saveProject(state: WorkspaceState, request: Request, url: URL): Promise<Response> {
  const data = await request.formData();
  state.projects.push(z.string().min(1).parse(data.get("name")));
  state.projectSaveCount += 1;
  return Response.redirect(new URL("/projects?saved=1", url), SEE_OTHER);
}
async function cancelProject(state: WorkspaceState, request: Request): Promise<Response> {
  const data = await request.formData();
  state.cancelledDrafts.push(z.string().parse(data.get("name")));
  return new Response("ok");
}
async function saveChoice(state: WorkspaceState, request: Request, url: URL): Promise<Response> {
  const data = await request.formData();
  state.choice = z.string().parse(data.get("priority"));
  state.choiceSaveCount += 1;
  return Response.redirect(new URL("/select-values?saved=1", url), SEE_OTHER);
}
async function saveDuplicateChoice(
  state: WorkspaceState,
  request: Request,
  url: URL,
): Promise<Response> {
  const data = await request.formData();
  state.duplicateChoice = z.string().parse(data.get("priority"));
  state.duplicateSaveCount += 1;
  return Response.redirect(new URL("/select-duplicate?saved=1", url), SEE_OTHER);
}
async function writeRoute(
  state: WorkspaceState,
  request: Request,
  url: URL,
): Promise<Response | undefined> {
  if (url.pathname === "/save") {
    return saveDocument(state, request, url);
  }
  if (url.pathname === "/profile") {
    return saveProfile(state, request, url);
  }
  if (url.pathname === "/projects") {
    return saveProject(state, request, url);
  }
  if (url.pathname === "/projects/cancel") {
    return cancelProject(state, request);
  }
  if (url.pathname === "/volatile") {
    state.volatileClickCount += 1;
    return Response.redirect(new URL("/volatile?done=1", url), SEE_OTHER);
  }
  if (url.pathname === "/volatile/replaced") {
    state.volatileRerendered = true;
    return new Response("ok");
  }
  if (url.pathname === "/select-values") {
    return saveChoice(state, request, url);
  }
  if (url.pathname === "/select-duplicate") {
    return saveDuplicateChoice(state, request, url);
  }
  return undefined;
}
function readRoute(state: WorkspaceState, url: URL): Response {
  if (url.pathname === "/profile") {
    return profilePage(state, url);
  }
  if (url.pathname === "/projects") {
    return projectsPage(state, url);
  }
  if (url.pathname === "/volatile") {
    return volatilePage(url);
  }
  if (url.pathname === "/volatile/version") {
    return new Response(String(state.volatileVersion));
  }
  if (url.pathname === "/help") {
    return helpPage();
  }
  if (url.pathname.startsWith("/panels/")) {
    return panelPage(url.pathname.slice("/panels/".length));
  }
  if (url.pathname === "/long") {
    return longPage();
  }
  if (url.pathname === "/select-values") {
    return selectPage(url, state.choice);
  }
  if (url.pathname === "/select-duplicate") {
    return duplicateSelectPage(url, state.duplicateChoice);
  }
  return documentsPage(state, url);
}
function createHandler(state: WorkspaceState): (request: Request) => Promise<Response> {
  return async (request): Promise<Response> => {
    const url = new URL(request.url);
    return (
      (request.method === "POST" ? await writeRoute(state, request, url) : undefined) ??
      readRoute(state, url)
    );
  };
}
function startWorkspace(): Workspace {
  const state: WorkspaceState = {
    documents: new Map<string, Document>([
      ["r-8", { title: "Roadmap Review", body: "Discuss milestones on Tuesday." }],
      ["c-3", { title: "Release Checklist", body: "Review the release checklist." }],
      ["f-99", { title: "Final Audit", body: "Audit complete." }],
    ]),
    projects: [],
    cancelledDrafts: [],
    profile: {
      displayName: "Initial name",
      summary: "Initial summary",
      priority: "normal",
      updates: false,
      visibility: "team",
    },
    saveCount: 0,
    profileSaveCount: 0,
    projectSaveCount: 0,
    volatileClickCount: 0,
    volatileVersion: 1,
    volatileRerendered: false,
    choice: "low-priority",
    choiceSaveCount: 0,
    duplicateChoice: "internal-high",
    duplicateSaveCount: 0,
  };
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: createHandler(state) });
  return {
    origin: server.url.origin,
    document: (id) => state.documents.get(id),
    saves: () => state.saveCount,
    profile: () => state.profile,
    profileSaves: () => state.profileSaveCount,
    projects: () => state.projects,
    projectSaves: () => state.projectSaveCount,
    cancelledDrafts: () => state.cancelledDrafts,
    volatileClicks: () => state.volatileClickCount,
    triggerRerender: () => {
      state.volatileVersion = 2;
    },
    rerendered: () => state.volatileRerendered,
    choice: () => state.choice,
    choiceSaves: () => state.choiceSaveCount,
    duplicateChoice: () => state.duplicateChoice,
    duplicateSaves: () => state.duplicateSaveCount,
    close: async () => {
      await server.stop(true);
    },
  };
}
export { startWorkspace };
export type { Workspace };
