import { chmod, mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import lockfile from "proper-lockfile";
import type { ReadonlyDeep } from "type-fest";
import type { z } from "zod";
import { SESSION_COUNT, indexSchema, sessionSchema } from "./schema.ts";
import type { Session, SessionSelection, Surface } from "./schema.ts";

const REUSE_MS = 3_600_000;
const TITLE_LENGTH = 60;
const ACTION_CONTEXT_COUNT = 12;
const PRIVATE_FILE = 0o600;
const PRIVATE_DIRECTORY = 0o700;
const LOCK_STALE_MS = 5000;
const LOCK_RETRIES = 80;
const LOCK_DELAY_MS = 100;
const AUTOMATIC: SessionSelection = { mode: "auto" };
type SessionIndex = ReadonlyDeep<z.infer<typeof indexSchema>>;
interface TurnHandle {
  readonly sessionId: string;
  readonly turnId: string;
}
interface TurnUpdate {
  readonly status?: "complete" | "blocked" | "error" | "stopped";
  readonly message?: string;
  readonly action?: string;
  readonly observation?: string;
  readonly surface?: Surface;
}
function updatedTurn(turn: Session["turns"][number], update: TurnUpdate): Session["turns"][number] {
  return {
    ...turn,
    ...(update.status === undefined ? {} : { status: update.status }),
    ...(update.message === undefined ? {} : { message: update.message }),
    ...(update.observation === undefined ? {} : { observation: update.observation }),
    ...(update.action === undefined
      ? {}
      : { actions: [...turn.actions, update.action].slice(-ACTION_CONTEXT_COUNT) }),
  };
}
class SessionStore {
  private readonly directory: string;
  public constructor(directory = "sessions") {
    this.directory = directory;
  }
  private async locked<Result>(operation: () => Promise<Result>): Promise<Result> {
    await mkdir(this.directory, { recursive: true, mode: PRIVATE_DIRECTORY });
    const release = await lockfile.lock(this.directory, {
      stale: LOCK_STALE_MS,
      retries: { retries: LOCK_RETRIES, minTimeout: LOCK_DELAY_MS, maxTimeout: LOCK_DELAY_MS },
    });
    try {
      return await operation();
    } finally {
      await release();
    }
  }
  private async index(): Promise<SessionIndex> {
    const file = Bun.file(path.join(this.directory, "index.json"));
    return (await file.exists()) ? indexSchema.parse(await file.json()) : { sessions: [] };
  }
  private async read(id: string): Promise<Session> {
    return sessionSchema.parse(await Bun.file(path.join(this.directory, `${id}.json`)).json());
  }
  private async write(file: string, value: Session | SessionIndex): Promise<void> {
    const target = path.join(this.directory, file);
    const temporary = `${target}.tmp`;
    await Bun.write(temporary, JSON.stringify(value));
    await chmod(temporary, PRIVATE_FILE);
    await rename(temporary, target);
  }
  private async save(index: SessionIndex, session: Session): Promise<void> {
    await this.write(`${session.id}.json`, session);
    const { id, title, createdAt, lastUsedAt } = session;
    const entries = [
      { id, title, createdAt, lastUsedAt },
      ...index.sessions.filter((entry) => entry.id !== id),
    ].toSorted((left, right) => right.lastUsedAt - left.lastUsedAt);
    await this.write("index.json", { ...index, sessions: entries.slice(0, SESSION_COUNT) });
    await Promise.all(
      entries
        .slice(SESSION_COUNT)
        .map(async (entry) => rm(path.join(this.directory, `${entry.id}.json`), { force: true })),
    );
  }
  public async begin(
    task: string,
    selection: SessionSelection = AUTOMATIC,
    now = Date.now(),
  ): Promise<{ handle: TurnHandle; session: Session }> {
    return this.locked(async () => {
      const index = await this.index();
      const candidate = index.sessions.find(
        (entry) => entry.id === (selection.mode === "resume" ? selection.id : index.activeId),
      );
      if (selection.mode === "resume" && candidate === undefined) {
        throw new Error("That session is no longer available. Start a new session.");
      }
      const reuse =
        candidate !== undefined &&
        (selection.mode === "resume" ||
          (selection.mode === "auto" && now - candidate.lastUsedAt <= REUSE_MS));
      const previous: Session = reuse
        ? await this.read(candidate.id)
        : {
            id: crypto.randomUUID(),
            title: task.replaceAll(/\s+/gu, " ").slice(0, TITLE_LENGTH),
            createdAt: now,
            lastUsedAt: now,
            turns: [],
          };
      const turnId = crypto.randomUUID();
      const session: Session = {
        ...previous,
        lastUsedAt: Math.max(now, previous.lastUsedAt),
        turns: [
          ...previous.turns,
          { id: turnId, task, startedAt: now, status: "running", actions: [] },
        ],
      };
      await this.save({ ...index, activeId: session.id }, session);
      return { handle: { sessionId: session.id, turnId }, session };
    });
  }
  public async update(handle: TurnHandle, update: TurnUpdate, now = Date.now()): Promise<void> {
    await this.locked(async () => {
      const index = await this.index();
      if (!index.sessions.some((entry) => entry.id === handle.sessionId)) {
        return;
      }
      const previous = await this.read(handle.sessionId);
      if (!previous.turns.some((turn) => turn.id === handle.turnId)) {
        throw new Error("The active session turn is missing");
      }
      const session: Session = {
        ...previous,
        lastUsedAt: Math.max(now, previous.lastUsedAt),
        turns: previous.turns.map((turn) =>
          turn.id === handle.turnId ? updatedTurn(turn, update) : turn,
        ),
        ...(update.surface === undefined ? {} : { surface: update.surface }),
      };
      await this.save(index, session);
    });
  }
  public async list(): Promise<SessionIndex> {
    return this.locked(async () => this.index());
  }
}
export { SessionStore, REUSE_MS };
export type { TurnHandle, TurnUpdate };
