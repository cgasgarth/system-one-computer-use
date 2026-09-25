import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { REUSE_MS, SessionStore } from "../src/app/sessions/store.ts";
import { SESSION_COUNT, sessionSchema } from "../src/app/sessions/schema.ts";
import { sessionContext } from "../src/app/sessions/context.ts";

const directories: string[] = [];
async function fixture(): Promise<{ store: SessionStore; directory: string }> {
  const directory = await mkdtemp(path.join(tmpdir(), "system-one-sessions-"));
  directories.push(directory);
  return { store: new SessionStore(directory), directory };
}
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map(async (directory) => rm(directory, { recursive: true, force: true })),
  );
});
test("reuses the session at one hour, then expires after more than one hour of inactivity", async () => {
  const { store } = await fixture();
  const first = await store.begin("Read messages", { mode: "auto" }, 0);
  const within = await store.begin("Show the latest", { mode: "auto" }, REUSE_MS);
  const after = await store.begin("New task", { mode: "auto" }, REUSE_MS + REUSE_MS + 1);
  expect(within.session.id).toBe(first.session.id);
  expect(after.session.id).not.toBe(first.session.id);
});
test("uses completed activity as the idle clock and restores context after process restart", async () => {
  const { store, directory } = await fixture();
  const first = await store.begin("Open a document", { mode: "auto" }, 0);
  await store.update(
    first.handle,
    { status: "complete", observation: "Document open", action: "Open document" },
    REUSE_MS,
  );
  const second = await new SessionStore(directory).begin(
    "Find the next heading",
    { mode: "auto" },
    REUSE_MS + 1,
  );
  expect(second.session.id).toBe(first.session.id);
  expect(sessionContext(second.session)).toContain("Document open");
  expect(sessionContext(second.session)).toContain("Open a document");
});
test("supports explicit new and manual resume, keeping only the last three sessions", async () => {
  const { store, directory } = await fixture();
  const first = await store.begin("First", { mode: "new" }, 0);
  const second = await store.begin("Second", { mode: "new" }, 1);
  const third = await store.begin("Third", { mode: "new" }, REUSE_MS);
  const resumed = await store.begin(
    "Follow up",
    { mode: "resume", id: first.session.id },
    REUSE_MS + REUSE_MS,
  );
  const fourth = await store.begin("Fourth", { mode: "new" }, REUSE_MS + REUSE_MS + 1);
  const index = await store.list();
  expect(resumed.session.id).toBe(first.session.id);
  expect(index.activeId).toBe(fourth.session.id);
  expect(index.sessions.map((session) => session.id)).toEqual([
    fourth.session.id,
    first.session.id,
    third.session.id,
  ]);
  expect(index.sessions).toHaveLength(SESSION_COUNT);
  expect(await Bun.file(path.join(directory, `${second.session.id}.json`)).exists()).toBe(false);
});
test("merges writes from separate workers without losing follow-up turns or switching the active session", async () => {
  const { store, directory } = await fixture();
  const old = await store.begin("First task");
  const next = await store.begin("Follow up");
  const other = new SessionStore(directory);
  await Promise.all([
    store.update(old.handle, { status: "stopped", message: "Stopped" }),
    other.update(next.handle, { action: "Inspect result", observation: "Fresh result" }),
  ]);
  const saved = sessionSchema.parse(
    await Bun.file(path.join(directory, `${old.session.id}.json`)).json(),
  );
  expect(saved.turns[0]?.status).toBe("stopped");
  expect(saved.turns[1]?.actions).toEqual(["Inspect result"]);
  const index = await store.list();
  expect(index.activeId).toBe(next.session.id);
});
