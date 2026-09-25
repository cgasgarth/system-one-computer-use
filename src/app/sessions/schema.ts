import { z } from "zod";
import type { ReadonlyDeep } from "type-fest";

const selectionSchema = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("auto") }),
  z.strictObject({ mode: z.literal("new") }),
  z.strictObject({ mode: z.literal("resume"), id: z.uuid() }),
]);
const surfaceSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("browser"),
    url: z.string(),
    title: z.string(),
  }),
  z.strictObject({
    kind: z.literal("desktop"),
    pid: z.number().int(),
    windowId: z.number().int(),
    app: z.string(),
    title: z.string(),
  }),
]);
const turnSchema = z.strictObject({
  id: z.uuid(),
  task: z.string(),
  startedAt: z.number(),
  status: z.enum(["running", "complete", "blocked", "error", "stopped"]),
  message: z.string().optional(),
  actions: z.array(z.string()),
  observation: z.string().optional(),
});
const sessionSchema = z.strictObject({
  id: z.uuid(),
  title: z.string(),
  createdAt: z.number(),
  lastUsedAt: z.number(),
  surface: surfaceSchema.optional(),
  turns: z.array(turnSchema),
});
const summarySchema = sessionSchema.pick({
  id: true,
  title: true,
  createdAt: true,
  lastUsedAt: true,
});
const SESSION_COUNT = 3;
const indexSchema = z.strictObject({
  activeId: z.uuid().optional(),
  sessions: z.array(summarySchema).max(SESSION_COUNT),
});
type Session = ReadonlyDeep<z.infer<typeof sessionSchema>>;
type SessionSummary = ReadonlyDeep<z.infer<typeof summarySchema>>;
type SessionSelection = ReadonlyDeep<z.infer<typeof selectionSchema>>;
type Surface = ReadonlyDeep<z.infer<typeof surfaceSchema>>;
export { selectionSchema, surfaceSchema, sessionSchema, indexSchema, SESSION_COUNT };
export type { Session, SessionSummary, SessionSelection, Surface };
