import { z } from "zod";
import type { Surface } from "../../agent/contracts.ts";
import type { ChromeWire } from "./wire.ts";

const tabSchema = z.object({ browserId: z.string().min(1), tabId: z.string().min(1) });
const savedSchema = tabSchema.extend({
  providerTabId: z.string().min(1),
  extensionInstanceId: z.string().min(1),
  url: z.string(),
  title: z.string(),
});
type BrowserSurface = Extract<Surface, { kind: "browser" }>;

async function bookmarkTab(
  wire: Readonly<Pick<ChromeWire, "read">>,
  tab: Readonly<z.infer<typeof tabSchema>>,
): Promise<BrowserSurface> {
  const saved = await wire.read(
    `const owned=(await s1Chrome.tabs.list()).filter((item)=>item.id===s1Tab.id);const browserMatches=(await s1Agent.browsers.list()).filter((item)=>item.id===s1Chrome.browserId);if(owned.length!==1||browserMatches.length!==1||!owned[0].url||owned[0].title===undefined)throw new Error('Task tab identity is unavailable');const released=(await s1Chrome.user.openTabs()).filter((item)=>item.id===s1Tab.id&&item.title===owned[0].title&&item.url===owned[0].url);const instance=browserMatches[0].metadata?.extensionInstanceId;if(released.length!==1||!released[0].providerTabId||!instance)throw new Error('Task tab has no exact provider identity');await s1Tab.markDeliverable();return {browserId:s1Chrome.browserId,tabId:s1Tab.id,providerTabId:released[0].providerTabId,extensionInstanceId:instance,url:owned[0].url,title:owned[0].title};`,
    savedSchema,
    "Save exact task Chrome tab",
  );
  if (saved.browserId !== tab.browserId || saved.tabId !== tab.tabId) {
    throw new Error("The task Chrome tab changed before it could be saved.");
  }
  return { kind: "browser", ...saved };
}

async function restoreTab(
  wire: Readonly<Pick<ChromeWire, "ready" | "read">>,
  surface: BrowserSurface,
): Promise<z.infer<typeof tabSchema>> {
  await wire.ready();
  const restored = await wire.read(
    `const exact=(await s1Agent.browsers.list()).filter((item)=>item.metadata?.extensionInstanceId===${JSON.stringify(surface.extensionInstanceId)});if(exact.length!==1)throw new Error('Saved Chrome profile is unavailable');if(s1Chrome.browserId!==exact[0].id){s1Chrome=await s1Agent.browsers.get(exact[0].id);nodeRepl.write(await s1Chrome.documentation());}const owned=(await s1Chrome.tabs.list()).filter((item)=>item.id===${JSON.stringify(surface.tabId)});let candidate;if(owned.length===1){const identity=(await s1Chrome.user.openTabs()).filter((item)=>item.id===${JSON.stringify(surface.tabId)}&&item.providerTabId===${JSON.stringify(surface.providerTabId)});if(identity.length!==1)throw new Error('Owned Chrome tab identity changed');candidate=await s1Chrome.tabs.get(owned[0].id);}else{const released=(await s1Chrome.user.openTabs()).filter((item)=>item.providerTabId===${JSON.stringify(surface.providerTabId)}&&item.title===${JSON.stringify(surface.title)}&&item.url===${JSON.stringify(surface.url)});if(released.length!==1)throw new Error('Exact saved Chrome tab is unavailable');candidate=await s1Chrome.user.claimTab(released[0]);if((await candidate.url())!==${JSON.stringify(surface.url)}||(await candidate.title())!==${JSON.stringify(surface.title)})throw new Error('Saved Chrome tab changed during claim');}s1Tab=candidate;return {browserId:s1Chrome.browserId,tabId:s1Tab.id};`,
    tabSchema,
    "Restore exact task Chrome tab",
  );
  if (restored.browserId !== surface.browserId) {
    throw new Error("The saved Chrome profile changed. Select a fresh tab.");
  }
  return restored;
}

export { bookmarkTab, restoreTab, tabSchema };
