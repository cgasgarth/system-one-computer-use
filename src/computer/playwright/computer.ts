import type { Desktop, Window } from "../../agent/contracts.ts";
import type { ClickAction, KeyAction, ManagedComputer, TypeAction } from "../types.ts";
import { PlaywrightConnection } from "./connection.ts";
import { parseSnapshot } from "./snapshot.ts";
import { closeConnectionPage, isConnectionPage } from "./tabs.ts";

const MODIFIERS = { cmd: "Meta", ctrl: "Control", option: "Alt", shift: "Shift", fn: "Fn" };

class PlaywrightComputer implements ManagedComputer {
  private readonly connection: PlaywrightConnection;
  private title = "Current Chrome tab";
  private prepared: Promise<void> | undefined = undefined;

  public constructor(token?: string) {
    this.connection = new PlaywrightConnection(token);
  }

  public async close(): Promise<void> {
    await this.connection.close();
  }

  public async desktop(): Promise<Desktop> {
    await this.connection.ready();
    this.prepared ??= closeConnectionPage(this.connection);
    await this.prepared;
    return {
      apps: [{ bundle_id: "com.google.Chrome", name: "Google Chrome", pid: 0 }],
      windows: [{ app_name: "Google Chrome", pid: 0, title: this.title, window_id: 0 }],
    };
  }

  public async window(): Promise<Window> {
    let window = parseSnapshot(await this.connection.call({ name: "browser_snapshot" }));
    if (window.url !== undefined && isConnectionPage(window.url)) {
      await closeConnectionPage(this.connection);
      window = parseSnapshot(await this.connection.call({ name: "browser_snapshot" }));
    }
    this.title = window.window_title;
    return window;
  }

  public async launchApp(): Promise<void> {
    await this.connection.call({ name: "browser_tabs", arguments: { action: "list" } });
  }

  public async navigate(url: string): Promise<void> {
    await this.connection.call({ name: "browser_navigate", arguments: { url } });
  }

  public async clickElement(action: ClickAction): Promise<void> {
    await this.connection.call({
      name: "browser_click",
      arguments: { target: action.element_token },
    });
  }

  public async typeText(action: TypeAction): Promise<void> {
    await this.connection.call({
      name: "browser_type",
      arguments: { target: action.element_token, text: action.text },
    });
  }

  public async pressKey(action: KeyAction): Promise<void> {
    const key = action.key === "return" ? "Enter" : action.key;
    await this.connection.call({
      name: "browser_press_key",
      arguments: {
        key: [...action.modifiers.map((modifier) => MODIFIERS[modifier]), key].join("+"),
      },
    });
  }
}

export { PlaywrightComputer };
