import type { ReadonlyDeep } from "type-fest";
import { z } from "zod";

const integer = z.number().int();
const appSchema = z.object({ name: z.string(), pid: integer, running: z.boolean() });
const appsSchema = z.object({ apps: z.array(appSchema) });
const preparedSchema = z.object({ prepared_pid: integer, status: z.literal("ok") });
const nativeWindowSchema = z.object({
  app_name: z.string(),
  is_on_screen: z.boolean(),
  pid: integer,
  title: z.string(),
  window_id: integer,
});
const windowsSchema = z.object({ windows: z.array(nativeWindowSchema) });
const tabSchema = z.object({ active: z.boolean(), tab_id: z.string() });
const tabsSchema = z.tuple([tabSchema]).rest(tabSchema);
const bindingSchema = z.object({
  status: z.literal("ok"),
  tabs: tabsSchema,
  target_id: z.string(),
});
const optionalValue = z.union([z.string(), z.number(), z.boolean(), z.null()]).optional();
const pageRefSchema = z.object({
  actions: z.array(z.string()),
  name: z.string().nullable(),
  ref: z.string(),
  role: z.string(),
  value: optionalValue,
  visibility: z.string(),
});
const contentRefs = z.array(pageRefSchema).optional();
const pageInfo = z.object({ title: z.string(), url: z.url() });
const snapshotInfo = z.object({ id: z.string() });
const pageSchema = z.object({
  content_refs: contentRefs,
  page: pageInfo,
  refs: z.array(pageRefSchema),
  snapshot: snapshotInfo,
  status: z.literal("ok"),
});
type BrowserRef = ReadonlyDeep<z.infer<typeof pageRefSchema>>;
type NativeWindow = ReadonlyDeep<z.infer<typeof nativeWindowSchema>>;
type Apps = ReadonlyDeep<z.infer<typeof appsSchema>>;
type BrowserBinding = ReadonlyDeep<z.infer<typeof bindingSchema>>;
type BrowserPage = ReadonlyDeep<z.infer<typeof pageSchema>>;
type NativeWindows = ReadonlyDeep<z.infer<typeof windowsSchema>>;
type PreparedBrowser = ReadonlyDeep<z.infer<typeof preparedSchema>>;

export { appsSchema, bindingSchema, pageSchema, preparedSchema, windowsSchema };
export type {
  Apps,
  BrowserBinding,
  BrowserPage,
  BrowserRef,
  NativeWindow,
  NativeWindows,
  PreparedBrowser,
};
