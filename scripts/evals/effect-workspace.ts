interface EffectWorkspace {
  readonly origin: string;
  readonly savedRecords: () => number;
  readonly invalidSaves: () => number;
  readonly invalidCreates: () => number;
  readonly close: () => Promise<void>;
}
interface Counters {
  savedRecords: number;
  invalidSaves: number;
  invalidCreates: number;
}
const SEE_OTHER = 303;
function page(content: string): Response {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8"><title>QA record</title></head><body><h1>QA record</h1>${content}</body></html>`,
    { headers: { "content-type": "text/html" } },
  );
}
function quickPage(invalid: boolean, error: boolean, saved: boolean): Response {
  const action = invalid ? "/quick-save-invalid" : "/quick-save";
  return page(
    `${error ? '<p role="alert">Validation error: the QA record was not saved.</p>' : ""}${saved ? '<p role="status">QA record saved.</p>' : `<p>QA record draft is ready.</p><form method="post" action="${action}"><button>Save QA record</button></form>`}`,
  );
}
function invalidCreatePage(error: boolean): Response {
  return page(
    `<h2>Projects</h2>${error ? '<p role="alert">Validation error: the project was not created.</p>' : ""}<dialog id="new-project"><h3>Create project</h3><form method="post" action="/create-invalid"><label>Project name <input name="name" value="Invalid QA Project" required></label><button>Create project</button><button type="button" onclick="this.closest('dialog').close()">Cancel</button></form></dialog><script>document.getElementById('new-project').showModal()</script>`,
  );
}
function startEffectWorkspace(): EffectWorkspace {
  const counters: Counters = { savedRecords: 0, invalidSaves: 0, invalidCreates: 0 };
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/quick-save" && request.method === "POST") {
        counters.savedRecords += 1;
        return Response.redirect(new URL("/quick-save?saved=1", url), SEE_OTHER);
      }
      if (url.pathname === "/quick-save") {
        return quickPage(false, false, url.searchParams.has("saved"));
      }
      if (url.pathname === "/quick-save-invalid" && request.method === "POST") {
        counters.invalidSaves += 1;
        return quickPage(true, true, false);
      }
      if (url.pathname === "/quick-save-invalid") {
        return quickPage(true, false, false);
      }
      if (url.pathname === "/create-invalid" && request.method === "POST") {
        counters.invalidCreates += 1;
        return invalidCreatePage(true);
      }
      if (url.pathname === "/create-invalid") {
        return invalidCreatePage(false);
      }
      return page("<p>Not found.</p>");
    },
  });
  return {
    origin: server.url.origin,
    savedRecords: () => counters.savedRecords,
    invalidSaves: () => counters.invalidSaves,
    invalidCreates: () => counters.invalidCreates,
    close: async () => {
      await server.stop(true);
    },
  };
}
export { startEffectWorkspace };
export type { EffectWorkspace };
