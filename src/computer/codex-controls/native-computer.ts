import type { Desktop, MenuInspection, Window } from "../../agent/contracts.ts";
import { taskDesktop } from "../targets.ts";
/* oxlint-disable typescript/prefer-readonly-parameter-types -- Injected SDK transport owns mutable session state. */
import type {
  ClickAction,
  InspectMenuAction,
  KeyAction,
  ManagedComputer,
  MenuAction,
  TypeAction,
} from "../types.ts";
import { WindowUnavailableError } from "../window-unavailable.ts";
import { appPid, menuElement, parseNativeMenuState, parseNativeState } from "./native-state.ts";
import type { ParsedNativeState } from "./native-state.ts";
import { NativeWire } from "./native-wire.ts";
import type { AppInfo, ToolSession } from "./native-wire.ts";
import type { CodexComputerOptions } from "./protocol.ts";

interface BoundApp {
  readonly id: string;
  readonly name: string;
  readonly pid: number;
}
const KEY_MODIFIERS = { cmd: "super", shift: "shift", option: "alt", ctrl: "ctrl" } as const;
const KEY_NAMES: Readonly<Record<string, string>> = {
  return: "Return",
  escape: "Escape",
  tab: "Tab",
  up: "Up",
  down: "Down",
};
const MAX_MENU_PATH = 16;
function uniqueApp(
  apps: readonly AppInfo[],
  name: string,
  runningOnly: boolean,
): AppInfo | undefined {
  const matches = apps.filter(
    (app) =>
      (app.id === name || app.displayName === name) && (!runningOnly || app.isRunning === true),
  );
  if (matches.length > 1) {
    throw new Error(`Several Codex apps match ${JSON.stringify(name)}. Choose an exact app ID.`);
  }
  return matches[0];
}
function bound(app: AppInfo): BoundApp {
  return { id: app.id, name: app.displayName ?? app.id, pid: appPid(app.id) };
}
function desktopApps(apps: readonly AppInfo[]): Desktop["apps"] {
  const ids = new Set<number>();
  return apps.map((app) => {
    const pid = appPid(app.id);
    if (ids.has(pid)) {
      throw new Error(
        "Two app identifiers map to one internal target ID. Native selection stopped.",
      );
    }
    ids.add(pid);
    return { bundle_id: app.id, name: app.displayName ?? app.id, pid };
  });
}
function menuReport(window: Window, topLevel: string): MenuInspection {
  return {
    pid: window.pid,
    window_id: window.window_id,
    topLevel,
    menus: (window.menus ?? []).filter((entry) => entry.path[0] === topLevel),
    complete: false,
  };
}
function matchingElement(window: Window, token: string): Window["elements"][number] | undefined {
  const matches = window.elements.filter((entry) => entry.element_token === token);
  return matches.length === 1 ? matches[0] : undefined;
}
function mappedModifier(modifier: KeyAction["modifiers"][number]): string {
  if (modifier === "fn") {
    throw new Error("Codex does not support the Fn modifier in native key chords.");
  }
  return KEY_MODIFIERS[modifier];
}
function parseActiveState(text: string, app: BoundApp): ParsedNativeState {
  try {
    return parseNativeState(text, { appId: app.id, appName: app.name, pid: app.pid });
  } catch (error) {
    if (error instanceof Error && error.message.includes("active app window")) {
      throw new WindowUnavailableError(error.message);
    }
    throw error;
  }
}

class CodexNativeComputer implements ManagedComputer {
  private readonly wire: NativeWire;
  private readonly options: Readonly<CodexComputerOptions>;
  private selected: BoundApp | undefined;
  private lastWindow: Window | undefined;
  private cachedWindow: Window | undefined;
  private openMenu: { readonly prior: Window; readonly topLevel: string } | undefined;
  private readonly windowKeys = new Map<number, string>();

  public constructor(options: Readonly<CodexComputerOptions>, session?: ToolSession) {
    this.options = options;
    this.wire = new NativeWire(options, session);
  }

  public async close(): Promise<void> {
    await this.wire.close();
  }

  public async bindApp(name: string): Promise<void> {
    const app = uniqueApp(await this.wire.listApps(), name, true);
    if (app === undefined) {
      throw new WindowUnavailableError("The saved app is not running. Choose an available app.");
    }
    await this.selectApp(app);
  }

  public async launchApp(name: string, signal?: Readonly<AbortSignal>): Promise<void> {
    signal?.throwIfAborted();
    this.options.signal?.throwIfAborted();
    const app = uniqueApp(await this.wire.listApps(), name, false);
    if (app === undefined) {
      throw new Error(`Codex does not list installed app ${JSON.stringify(name)}.`);
    }
    signal?.throwIfAborted();
    await this.selectApp(app);
  }

  private async selectApp(app: AppInfo): Promise<void> {
    await this.wire.bindApp(app.id);
    this.selected = bound(app);
    this.lastWindow = undefined;
    this.cachedWindow = undefined;
    this.openMenu = undefined;
  }

  public async desktop(): Promise<Desktop> {
    const listed = await this.wire.listApps();
    const apps = desktopApps(listed);
    const current = this.selected;
    if (current === undefined || listed.find((app) => app.id === current.id)?.isRunning !== true) {
      return taskDesktop({ apps, windows: [] });
    }
    try {
      const window = await this.readFresh();
      this.cachedWindow = window;
      return taskDesktop({
        apps,
        windows: [
          {
            app_name: window.app_name,
            pid: window.pid,
            window_id: window.window_id,
            title: window.window_title,
          },
        ],
      });
    } catch (error) {
      if (error instanceof WindowUnavailableError) {
        return taskDesktop({ apps, windows: [] });
      }
      throw error;
    }
  }

  private async readFresh(): Promise<Window> {
    const app = this.selected;
    if (app === undefined) {
      throw new WindowUnavailableError("Choose a native app before reading its window.");
    }
    const text = await this.wire.readState();
    const isWindowTree = /^0 (?:standard window|dialog|sheet|popover|alert)/u.test(
      text.split("\n")[1] ?? "",
    );
    const window = isWindowTree
      ? this.checkedWindow(parseActiveState(text, app), app)
      : this.readBoundMenu(text, app);
    if (isWindowTree) {
      this.openMenu = undefined;
    }
    this.lastWindow = window;
    return window;
  }

  private checkedWindow(parsed: ParsedNativeState, app: BoundApp): Window {
    const identity = `${app.id}\u0000${parsed.windowKey}`;
    const previous = this.windowKeys.get(parsed.window.window_id);
    if (previous !== undefined && previous !== identity) {
      throw new Error("Two native windows map to one internal target ID. Input stopped.");
    }
    this.windowKeys.set(parsed.window.window_id, identity);
    return parsed.window;
  }

  private readBoundMenu(text: string, app: BoundApp): Window {
    const menu = this.openMenu;
    if (menu === undefined) {
      throw new WindowUnavailableError("The active app window is showing an unbound native view.");
    }
    return parseNativeMenuState(text, {
      scope: { appId: app.id, appName: app.name, pid: app.pid },
      prior: menu.prior,
      topLevel: menu.topLevel,
    });
  }

  private async readOpenedMenu(prior: Window, topLevel: string): Promise<Window> {
    this.openMenu = { prior, topLevel };
    try {
      return await this.readFresh();
    } catch (error) {
      this.openMenu = undefined;
      throw error;
    }
  }

  public async window(pid: number, windowId: number): Promise<Window> {
    const cached = this.cachedWindow;
    this.cachedWindow = undefined;
    const observed =
      cached?.pid === pid && cached.window_id === windowId ? cached : await this.readFresh();
    if (observed.pid !== pid || observed.window_id !== windowId) {
      throw new WindowUnavailableError("The active app window changed. Observe it again.");
    }
    return observed;
  }

  private async freshElement(
    action: ClickAction | TypeAction | KeyAction,
  ): Promise<Window["elements"][number]> {
    const selected = this.lastWindow;
    const previous =
      selected === undefined ? undefined : matchingElement(selected, action.element_token);
    const fresh = await this.readFresh();
    if (fresh.pid !== action.pid || fresh.window_id !== action.window_id) {
      throw new WindowUnavailableError("The active app window changed before input.");
    }
    const current = matchingElement(fresh, action.element_token);
    if (
      previous === undefined ||
      current === undefined ||
      current.enabled === false ||
      previous.role !== current.role ||
      previous.label !== current.label ||
      previous.parent_index !== current.parent_index ||
      previous.value !== current.value
    ) {
      throw new Error("The selected native control changed. Observe it again before input.");
    }
    this.options.signal?.throwIfAborted();
    return current;
  }

  public async clickElement(action: ClickAction): Promise<void> {
    const current = await this.freshElement(action);
    if (
      !(current.actions ?? []).includes("AXPress") ||
      (action.operation !== undefined && action.operation !== "press")
    ) {
      throw new Error("The selected native control cannot be clicked with this operation.");
    }
    await this.wire.click(current.element_index);
  }

  public async typeText(action: TypeAction): Promise<void> {
    const current = await this.freshElement(action);
    if (current.editable !== true || !(current.actions ?? []).includes("AXSetValue")) {
      throw new Error("The selected native field is not observed as settable.");
    }
    await this.wire.setValue(current.element_index, action.text);
  }

  public async pressKey(action: KeyAction): Promise<void> {
    const current = await this.freshElement(action);
    const fresh = this.lastWindow;
    if (
      current.focused !== true ||
      fresh?.elements.filter((entry) => entry.focused === true).length !== 1
    ) {
      throw new Error("The selected native key target no longer has unique focus.");
    }
    const modifiers = action.modifiers.map(mappedModifier);
    await this.wire.pressKey([...modifiers, KEY_NAMES[action.key] ?? action.key].join("+"));
  }

  public async inspectMenu(
    action: InspectMenuAction,
    currentWindow?: Window,
  ): Promise<MenuInspection> {
    const current = currentWindow ?? (await this.window(action.pid, action.window_id));
    if (
      current.pid !== action.pid ||
      current.window_id !== action.window_id ||
      current.menuNames?.filter((name) => name === action.topLevel).length !== 1
    ) {
      throw new Error("The selected native menu changed. Observe it again.");
    }
    const visible = menuReport(current, action.topLevel);
    if (visible.menus.length > 0 || this.openMenu?.topLevel === action.topLevel) {
      return visible;
    }
    const top = current.elements.filter(
      (entry) =>
        entry.role === "AXMenuBarItem" &&
        entry.label === action.topLevel &&
        entry.enabled !== false,
    );
    if (top.length !== 1 || top[0] === undefined) {
      throw new Error("The selected native menu cannot be opened unambiguously.");
    }
    this.options.signal?.throwIfAborted();
    await this.wire.click(top[0].element_index);
    const opened = await this.readOpenedMenu(current, action.topLevel);
    if (opened.pid !== action.pid || opened.window_id !== action.window_id) {
      throw new WindowUnavailableError("The active app window changed while opening its menu.");
    }
    return menuReport(opened, action.topLevel);
  }

  public async invokeMenu(action: MenuAction): Promise<void> {
    if (action.path.length > MAX_MENU_PATH) {
      throw new Error("The observed menu path exceeds the supported depth.");
    }
    const fresh = await this.window(action.pid, action.window_id);
    const entry = fresh.menus?.filter(
      (menu) =>
        menu.enabled &&
        menu.path.length === action.path.length &&
        menu.path.every((part, index) => part === action.path[index]),
    );
    const element = menuElement(fresh, action.path);
    if (entry?.length !== 1 || element === undefined || element.enabled === false) {
      throw new Error("The selected menu command changed or is unavailable. Open the menu again.");
    }
    this.options.signal?.throwIfAborted();
    await this.wire.click(element.element_index);
    this.openMenu = undefined;
  }
}

export { CodexNativeComputer };
