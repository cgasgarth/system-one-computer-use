import { z } from "zod";
import type { ReadonlyDeep } from "type-fest";
import { zeroWrites } from "./benchmark-cases.ts";
import type { WriteCounts } from "./benchmark-cases.ts";

const SEE_OTHER = 303;
const ORDER = z.enum(["target", "decoy-1", "decoy-2"]);
const variantSchema = z.strictObject({
  document: z.strictObject({
    id: z.string().min(1),
    title: z.string().min(1),
    initialText: z.string(),
    requestedText: z.string(),
    decoys: z.tuple([z.string().min(1), z.string().min(1)]),
    editorLabel: z.string().min(1),
    saveLabel: z.string().min(1),
  }),
  draft: z.strictObject({
    field: z.string().min(1),
    requestedText: z.string().min(1),
    openLabel: z.string().min(1),
    createLabel: z.string().min(1),
    cancelLabel: z.string().min(1),
  }),
  choice: z.strictObject({
    field: z.string().min(1),
    initialGroup: z.string().min(1),
    targetGroup: z.string().min(1),
    duplicateLabel: z.string().min(1),
    initialValue: z.string().min(1),
    targetValue: z.string().min(1),
    saveLabel: z.string().min(1),
  }),
  presentation: z.strictObject({
    documentLayout: z.enum(["cards", "table"]),
    documentOrder: z
      .tuple([ORDER, ORDER, ORDER])
      .refine((items) => new Set(items).size === items.length),
    editorLayout: z.enum(["fieldset", "plain"]),
    choiceOrder: z.enum(["initial-first", "target-first"]),
    choiceButtonFirst: z.boolean(),
  }),
});
type VariantConfig = z.infer<typeof variantSchema>;
interface VariantState {
  readonly documents: Map<string, string>;
  readonly projects: string[];
  choiceValue: string;
  writes: WriteCounts;
}
interface VariantWorkspace {
  readonly origin: string;
  readonly config: ReadonlyDeep<VariantConfig>;
  readonly reset: () => void;
  readonly close: () => Promise<void>;
  readonly documentBody: (id: string) => string | undefined;
  readonly projects: () => readonly string[];
  readonly choiceValue: () => string;
  readonly writes: () => WriteCounts;
}
function escape(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
}
function fresh(config: ReadonlyDeep<VariantConfig>): VariantState {
  return {
    documents: new Map([
      [config.document.id, config.document.initialText],
      ["decoy-1", "A separate synthetic note."],
      ["decoy-2", "Another separate synthetic note."],
    ]),
    projects: [],
    choiceValue: config.choice.initialValue,
    writes: { ...zeroWrites },
  };
}
function page(title: string, body: string): Response {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><title>${escape(title)}</title></head><body><h1>Local validation workspace</h1><nav><a href="/">All documents</a></nav>${body}</body></html>`,
    { headers: { "content-type": "text/html" } },
  );
}
function documentList(config: ReadonlyDeep<VariantConfig>): Response {
  const titles = new Map([
    ["target", config.document.title],
    ["decoy-1", config.document.decoys[0]],
    ["decoy-2", config.document.decoys[1]],
  ]);
  const links = config.presentation.documentOrder.map((item) => {
    const id = item === "target" ? config.document.id : item;
    return `<a href="/document/${encodeURIComponent(id)}">${escape(titles.get(item) ?? "")}</a>`;
  });
  const list =
    config.presentation.documentLayout === "cards"
      ? links.map((link) => `<section><h2>${link}</h2></section>`).join("")
      : `<table><tbody>${links.map((link) => `<tr><td>${link}</td></tr>`).join("")}</tbody></table>`;
  return page("Documents", `${list}<p>Select a document.</p>`);
}
function documentPage(
  config: ReadonlyDeep<VariantConfig>,
  state: ReadonlyDeep<VariantState>,
  url: Readonly<URL>,
): Response {
  const id = decodeURIComponent(url.pathname.slice("/document/".length));
  const body = state.documents.get(id);
  if (body === undefined) {
    return new Response("Document missing", { status: 404 });
  }
  const title =
    id === config.document.id
      ? config.document.title
      : config.document.decoys[id === "decoy-1" ? 0 : 1];
  return page(
    title,
    `<h2>${escape(title)}</h2><p>Saved text: ${escape(body)}</p>${url.searchParams.has("saved") ? '<p role="status">Document stored.</p>' : ""}<form method="post" action="/save"><input type="hidden" name="id" value="${escape(id)}"><label>${escape(config.document.editorLabel)}<textarea name="body">${escape(body)}</textarea></label><button>${escape(config.document.saveLabel)}</button></form>`,
  );
}
function draftPage(
  config: ReadonlyDeep<VariantConfig>,
  state: ReadonlyDeep<VariantState>,
  url: Readonly<URL>,
): Response {
  const field = `<label>${escape(config.draft.field)}<input name="name" required></label>`;
  const input =
    config.presentation.editorLayout === "fieldset" ? `<fieldset>${field}</fieldset>` : field;
  const names = state.projects.map((name) => `<li>${escape(name)}</li>`).join("");
  return page(
    "Draft editor",
    `<h2>Drafts</h2><ul>${names}</ul><button type="button" onclick="document.getElementById('editor').showModal()">${escape(config.draft.openLabel)}</button><dialog id="editor"><h3>New draft</h3><form method="post" action="/draft">${input}<button type="button" onclick="this.closest('dialog').close()">${escape(config.draft.cancelLabel)}</button><button>${escape(config.draft.createLabel)}</button></form></dialog>${url.searchParams.has("open") ? "<script>document.getElementById('editor').showModal()</script>" : ""}`,
  );
}
function choicePage(
  config: ReadonlyDeep<VariantConfig>,
  state: ReadonlyDeep<VariantState>,
  url: Readonly<URL>,
): Response {
  const groups = [
    { label: config.choice.initialGroup, value: config.choice.initialValue },
    { label: config.choice.targetGroup, value: config.choice.targetValue },
  ];
  const ordered = config.presentation.choiceOrder === "target-first" ? groups.toReversed() : groups;
  const options = ordered
    .map(
      (group) =>
        `<optgroup label="${escape(group.label)}"><option value="${escape(group.value)}" ${state.choiceValue === group.value ? "selected" : ""}>${escape(config.choice.duplicateLabel)}</option></optgroup>`,
    )
    .join("");
  const select = `<label>${escape(config.choice.field)}<select name="choice">${options}</select></label>`;
  const button = `<button>${escape(config.choice.saveLabel)}</button>`;
  return page(
    "Choice settings",
    `<h2>Choice settings</h2>${url.searchParams.has("saved") ? '<p role="status">Choice stored.</p>' : ""}<form method="post" action="/choice">${config.presentation.choiceButtonFirst ? `${button}${select}` : `${select}${button}`}</form>`,
  );
}
async function writeRoute(
  // The local fixture mutates its owned state for the grader.
  // oxlint-disable-next-line typescript/prefer-readonly-parameter-types
  state: VariantState,
  request: ReadonlyDeep<Request>,
  url: Readonly<URL>,
): Promise<Response | undefined> {
  if (request.method !== "POST") {
    return undefined;
  }
  const data = await request.formData();
  if (url.pathname === "/save") {
    const id = z.string().parse(data.get("id"));
    if (!state.documents.has(id)) {
      return new Response("Document missing", { status: 404 });
    }
    state.documents.set(id, z.string().parse(data.get("body")));
    state.writes = { ...state.writes, documents: state.writes.documents + 1 };
    return Response.redirect(
      new URL(`/document/${encodeURIComponent(id)}?saved=1`, url),
      SEE_OTHER,
    );
  }
  if (url.pathname === "/draft") {
    state.projects.push(z.string().min(1).parse(data.get("name")));
    state.writes = { ...state.writes, projects: state.writes.projects + 1 };
    return Response.redirect(new URL("/draft?saved=1", url), SEE_OTHER);
  }
  if (url.pathname === "/choice") {
    state.choiceValue = z.string().min(1).parse(data.get("choice"));
    state.writes = { ...state.writes, duplicateChoices: state.writes.duplicateChoices + 1 };
    return Response.redirect(new URL("/choice?saved=1", url), SEE_OTHER);
  }
  return undefined;
}
function startVariantWorkspace(raw: unknown): VariantWorkspace {
  const config = variantSchema.parse(raw);
  let state = fresh(config);
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const written = await writeRoute(state, request, url);
      if (written !== undefined) {
        return written;
      }
      if (url.pathname === "/") {
        return documentList(config);
      }
      if (url.pathname.startsWith("/document/")) {
        return documentPage(config, state, url);
      }
      if (url.pathname === "/draft") {
        return draftPage(config, state, url);
      }
      return url.pathname === "/choice"
        ? choicePage(config, state, url)
        : new Response("Missing", { status: 404 });
    },
  });
  return {
    origin: server.url.origin,
    config,
    reset: () => {
      state = fresh(config);
    },
    close: async () => {
      await server.stop(true);
    },
    documentBody: (id) => state.documents.get(id),
    projects: () => state.projects,
    choiceValue: () => state.choiceValue,
    writes: () => state.writes,
  };
}
export { startVariantWorkspace, variantSchema };
export type { VariantConfig, VariantWorkspace };
