/** Cua's exact browser target as a Computer for System One decisions. */

import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { z } from 'zod';
import type { Computer } from './cua';
import type { Desktop, Window } from './contracts';

const appsSchema = z.object({ apps: z.array(z.object({ name: z.string(), pid: z.number().int(), running: z.boolean() })) });
const preparedSchema = z.object({ status: z.literal('ok'), prepared_pid: z.number().int() });
const windowsSchema = z.object({ windows: z.array(z.object({
  pid: z.number().int(), window_id: z.number().int(), app_name: z.string(),
  title: z.string(), is_on_screen: z.boolean(),
})) });
const bindingSchema = z.object({ status: z.literal('ok'), target_id: z.string(),
  tabs: z.array(z.object({ tab_id: z.string(), active: z.boolean() })).min(1) });
const pageRefSchema = z.object({
    ref: z.string(), role: z.string(), name: z.string().nullable(), value: z.unknown().nullable().optional(),
    actions: z.array(z.string()), visibility: z.string(),
});
const pageSchema = z.object({ status: z.literal('ok'), page: z.object({ title: z.string(), url: z.string() }),
  snapshot: z.object({ id: z.string() }), refs: z.array(pageRefSchema),
  content_refs: z.array(pageRefSchema).optional() });

export class CuaBrowserComputer implements Computer {
  private readonly client = new Client({ name: 'system-one-computer-use', version: '0.1.0' });
  private readonly session = `system-one-browser-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  private connected?: Promise<void>;
  private ready?: Promise<void>;
  private pid?: number;
  private windowId?: number;
  private targetId?: string;
  private tabId?: string;
  private pageTitle = 'about:blank';

  constructor(private readonly browserApp = 'Google Chrome', private readonly binary = 'cua-driver') {}

  private async call(name: string, args: Record<string, unknown>): Promise<unknown> {
    this.connected ??= this.client.connect(new StdioClientTransport({ command: this.binary, args: ['mcp'] }));
    await this.connected;
    const result = await this.client.callTool({ name, arguments: { ...args, session: this.session } });
    const state = result.structuredContent as { status?: string; effect?: string } | undefined;
    if (result.isError || state?.status === 'refused' || state?.effect === 'refused') {
      const detail = result.content?.filter(item => item.type === 'text').map(item => item.text).join(' ') ||
        JSON.stringify(result.structuredContent);
      throw new Error(`Cua ${name} failed: ${detail.slice(0, 800)}`);
    }
    if (!result.structuredContent) throw new Error(`Cua ${name} returned no structured result`);
    return result.structuredContent;
  }

  private async prepare(): Promise<void> {
    this.ready ??= (async () => {
      const apps = appsSchema.parse(await this.call('list_apps', {}));
      const browser = apps.apps.find(app => app.name === this.browserApp && app.running && app.pid > 0);
      if (!browser) throw new Error(`Start ${this.browserApp} before browser tasks`);
      const prepared = preparedSchema.parse(await this.call('browser_prepare', {
        pid: browser.pid, profile: { mode: 'isolated_new' }, allow_launch: true,
      }));
      this.pid = prepared.prepared_pid;
      let window: z.infer<typeof windowsSchema>['windows'][number] | undefined;
      for (let attempt = 0; attempt < 4 && !window; attempt++) {
        if (attempt) await Bun.sleep(150);
        const windows = windowsSchema.parse(await this.call('list_windows', {}));
        window = windows.windows.find(item => item.pid === this.pid && item.is_on_screen && item.title);
      }
      if (!window) throw new Error(`Cua did not expose the isolated ${this.browserApp} window`);
      this.windowId = window.window_id;
      const binding = bindingSchema.parse(await this.call('get_browser_state', {
        pid: this.pid, window_id: this.windowId, snapshot_format: 'semantic_v2',
      }));
      const activeTab = binding.tabs.find(tab => tab.active) || binding.tabs[0];
      this.targetId = binding.target_id;
      this.tabId = activeTab.tab_id;
      this.pageTitle = window.title;
    })();
    await this.ready;
  }

  async close(): Promise<void> {
    if (this.connected) await this.client.close();
  }

  async desktop(): Promise<Desktop> {
    await this.prepare();
    const windows = windowsSchema.parse(await this.call('list_windows', {}));
    const current = windows.windows.find(item => item.pid === this.pid && item.window_id === this.windowId && item.is_on_screen);
    if (!current) throw new Error(`The isolated ${this.browserApp} window is no longer visible`);
    return { apps: [{ name: this.browserApp, pid: this.pid! }],
      windows: [{ app_name: this.browserApp, pid: this.pid!, window_id: this.windowId!, title: this.pageTitle }] };
  }

  async window(pid: number, windowId: number): Promise<Window> {
    await this.prepare();
    if (pid !== this.pid || windowId !== this.windowId) throw new Error('Browser window changed');
    const page = pageSchema.parse(await this.call('get_browser_state', {
      target_id: this.targetId, tab_id: this.tabId, snapshot_format: 'semantic_v2',
    }));
    this.pageTitle = page.page.url;
    return { pid, window_id: windowId, snapshot_id: page.snapshot.id,
      app_name: this.browserApp, window_title: this.pageTitle,
      elements: [...page.refs, ...(page.content_refs || [])]
        .filter(ref => ref.visibility === 'in_viewport').slice(0, 150).map((ref, index) => ({
        element_index: index, element_token: ref.ref, role: ref.role,
        label: ref.name || ref.role, value: ref.value,
        actions: [
          ...(ref.actions.includes('click') ? ['AXPress'] : []),
          ...(ref.actions.includes('type') ? ['AXSetValue'] : []),
        ],
      })) };
  }

  async navigate(url: string): Promise<void> {
    await this.prepare();
    const parsed = new URL(url);
    if (!['http:', 'https:', 'about:'].includes(parsed.protocol)) throw new Error('Browser URL must use http, https, or about');
    await this.call('browser_navigate', { target_id: this.targetId, tab_id: this.tabId, url });
  }

  async launchApp(_name: string): Promise<void> {
    throw new Error('The isolated browser is already open');
  }

  async clickElement(pid: number, windowId: number, elementToken: string): Promise<void> {
    if (pid !== this.pid || windowId !== this.windowId) throw new Error('Browser window changed');
    await this.call('browser_click', { target_id: this.targetId, tab_id: this.tabId,
      ref: elementToken, input_route: 'dom_event' });
  }

  async typeText(pid: number, windowId: number, elementToken: string, text: string): Promise<void> {
    if (pid !== this.pid || windowId !== this.windowId) throw new Error('Browser window changed');
    await this.call('browser_type', { target_id: this.targetId, tab_id: this.tabId,
      ref: elementToken, text, replace: true });
  }

  async pressKey(pid: number, windowId: number, key: string, modifiers: string[]): Promise<void> {
    if (pid !== this.pid || windowId !== this.windowId) throw new Error('Browser window changed');
    await this.call('press_key', { pid, window_id: windowId, key, modifiers });
  }
}
