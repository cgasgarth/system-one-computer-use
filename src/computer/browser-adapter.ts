import type { Desktop, Window } from "../agent/contracts.ts";
import type { BrowserRef, NativeWindow } from "./browser-schema.ts";
import { CuaConnection } from "./connection.ts";
import type { BrowserTarget, ClickAction, Computer, KeyAction, TypeAction } from "./types.ts";

const MAX_ELEMENTS = 150;
const PREPARE_ATTEMPTS = 4;
const PREPARE_DELAY_MS = 150;

function control(ref: BrowserRef, index: number): Window["elements"][number] {
  const actions: string[] = [];
  if (ref.actions.includes("click")) {
    actions.push("AXPress");
  }
  if (ref.actions.includes("type")) {
    actions.push("AXSetValue");
  }
  return {
    actions,
    element_index: index,
    element_token: ref.ref,
    label: ref.name ?? ref.role,
    role: ref.role,
    value: ref.value,
  };
}

class CuaBrowserComputer implements Computer {
  private readonly browserApp: string;
  private readonly connection: CuaConnection;
  private ready: Promise<BrowserTarget> | undefined = undefined;
  private pageTitle = "about:blank";

  public constructor(browserApp = "Google Chrome", binary = "cua-driver") {
    this.browserApp = browserApp;
    this.connection = new CuaConnection(binary);
  }

  private async findWindow(pid: number): Promise<NativeWindow> {
    for (let attempt = 0; attempt < PREPARE_ATTEMPTS; attempt += 1) {
      if (attempt > 0) {
        await Bun.sleep(PREPARE_DELAY_MS);
      }
      const state = await this.connection.windows();
      const window = state.windows.find(
        (item) => item.pid === pid && item.is_on_screen && item.title.length > 0,
      );
      if (window !== undefined) {
        return window;
      }
    }
    throw new Error(`Cua did not expose the isolated ${this.browserApp} window`);
  }

  private async bind(window: NativeWindow): Promise<BrowserTarget> {
    const binding = await this.connection.bindBrowser(window);
    const active = binding.tabs.find((tab) => tab.active) ?? binding.tabs[0];
    this.pageTitle = window.title;
    return {
      pid: window.pid,
      tabId: active.tab_id,
      targetId: binding.target_id,
      windowId: window.window_id,
    };
  }

  private async createTarget(): Promise<BrowserTarget> {
    const apps = await this.connection.apps();
    const browser = apps.apps.find(
      (app) => app.name === this.browserApp && app.running && app.pid > 0,
    );
    if (browser === undefined) {
      throw new Error(`Start ${this.browserApp} before browser tasks`);
    }
    const prepared = await this.connection.prepareBrowser(browser.pid);
    const window = await this.findWindow(prepared.prepared_pid);
    return this.bind(window);
  }

  private async prepare(): Promise<BrowserTarget> {
    this.ready ??= this.createTarget();
    return this.ready;
  }

  private async exactTarget(pid: number, windowId: number): Promise<BrowserTarget> {
    const target = await this.prepare();
    if (pid !== target.pid || windowId !== target.windowId) {
      throw new Error("Browser window changed");
    }
    return target;
  }

  public async close(): Promise<void> {
    await this.connection.close();
  }

  public async desktop(): Promise<Desktop> {
    const target = await this.prepare();
    const windows = await this.connection.windows();
    const current = windows.windows.find(
      (item) => item.pid === target.pid && item.window_id === target.windowId && item.is_on_screen,
    );
    if (current === undefined) {
      throw new Error(`The isolated ${this.browserApp} window is no longer visible`);
    }
    return {
      apps: [{ name: this.browserApp, pid: target.pid }],
      windows: [
        {
          app_name: this.browserApp,
          pid: target.pid,
          title: this.pageTitle,
          window_id: target.windowId,
        },
      ],
    };
  }

  public async window(pid: number, windowId: number): Promise<Window> {
    const target = await this.exactTarget(pid, windowId);
    const page = await this.connection.browserPage(target);
    this.pageTitle = `${page.page.title} | ${page.page.url}`;
    const refs = [...page.refs, ...(page.content_refs ?? [])];
    const visible = refs.filter((ref) => ["in_viewport", "near_viewport"].includes(ref.visibility));
    return {
      app_name: this.browserApp,
      elements: visible.slice(0, MAX_ELEMENTS).map((ref, index) => control(ref, index)),
      pid,
      snapshot_id: page.snapshot.id,
      url: page.page.url,
      window_id: windowId,
      window_title: this.pageTitle,
    };
  }

  public async navigate(url: string): Promise<void> {
    const target = await this.prepare();
    if (!["http:", "https:", "about:"].includes(new URL(url).protocol)) {
      throw new Error("Browser URL must use http, https, or about");
    }
    await this.connection.navigateBrowser(target, url);
  }

  public async launchApp(name: string): Promise<void> {
    await this.prepare();
    throw new Error(`Cannot launch ${name} through the isolated ${this.browserApp} driver`);
  }

  public async clickElement(action: ClickAction): Promise<void> {
    const target = await this.exactTarget(action.pid, action.window_id);
    await this.connection.clickBrowser(target, action);
  }

  public async typeText(action: TypeAction): Promise<void> {
    const target = await this.exactTarget(action.pid, action.window_id);
    await this.connection.typeBrowser(target, action);
  }

  public async pressKey(action: KeyAction): Promise<void> {
    await this.exactTarget(action.pid, action.window_id);
    await this.connection.pressKey(action);
  }
}

export { CuaBrowserComputer };
