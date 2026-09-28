import type { Computer, ManagedComputer } from "../computer/types.ts";
import type { Action, Desktop, MenuInspection, Observation, Surface } from "./contracts.ts";
import { WindowUnavailableError } from "../computer/window-unavailable.ts";
import { textFieldKey } from "./state-key.ts";

interface Target {
  readonly pid: number;
  readonly windowId: number;
}
const MENU_ERROR_CHARS = 200;
async function restoreSurface(
  computer: Readonly<Pick<ManagedComputer, "desktop" | "restore" | "bindApp">>,
  surface: Surface,
): Promise<{ readonly pid: number; readonly windowId: number } | undefined> {
  if (surface.kind === "browser") {
    if (computer.restore === undefined) {
      throw new Error("This driver cannot restore the saved browser tab");
    }
    await computer.restore(surface);
    return undefined;
  }
  if (computer.bindApp !== undefined) {
    try {
      await computer.bindApp(surface.app);
    } catch (error) {
      if (error instanceof WindowUnavailableError) {
        return undefined;
      }
      throw error;
    }
  }
  const desktop = await computer.desktop();
  const exact = desktop.windows.find(
    (window) =>
      window.pid === surface.pid &&
      window.window_id === surface.windowId &&
      window.app_name === surface.app,
  );
  const candidates = desktop.windows.filter(
    (window) => window.app_name === surface.app && window.title === surface.title,
  );
  const target = exact ?? (candidates.length === 1 ? candidates[0] : undefined);
  if (target !== undefined) {
    return { pid: target.pid, windowId: target.window_id };
  }
  return undefined;
}
class SurfaceSession {
  public mode: "browser" | "desktop" | undefined;
  public needsApplication = false;
  public target: Target | undefined = undefined;
  private application: Desktop["apps"][number] | undefined;
  private desktopTarget: Target | undefined;
  private inspectedMenu: Pick<MenuInspection, "pid" | "window_id" | "topLevel"> | undefined;
  private readonly restoreAttempts = new Set<string>();
  public setTarget(target: Target | undefined): void {
    if (this.target?.pid !== target?.pid || this.target?.windowId !== target?.windowId) {
      this.inspectedMenu = undefined;
    }
    this.target = target;
    if (this.mode === "desktop") {
      this.desktopTarget = target;
    }
  }
  public selectApplication(application: Desktop["apps"][number] | undefined): void {
    this.inspectedMenu = undefined;
    this.application = application;
    this.needsApplication = false;
  }
  public setMenuInspection(report: MenuInspection): void {
    if (
      this.mode !== "desktop" ||
      this.target?.pid !== report.pid ||
      this.target.windowId !== report.window_id
    ) {
      throw new Error("The inspected menu no longer belongs to the selected window.");
    }
    this.inspectedMenu = {
      pid: report.pid,
      window_id: report.window_id,
      topLevel: report.topLevel,
    };
  }
  public clearMenuInspection(): void {
    this.inspectedMenu = undefined;
  }
  private async withMenuInspection(
    computer: Readonly<ManagedComputer>,
    observation: Observation,
  ): Promise<Observation> {
    const selected = this.inspectedMenu;
    const { window } = observation;
    if (selected === undefined) {
      return observation;
    }
    if (
      window === undefined ||
      window.pid !== selected.pid ||
      window.window_id !== selected.window_id
    ) {
      this.clearMenuInspection();
      return observation;
    }
    if (computer.inspectMenu === undefined) {
      this.clearMenuInspection();
      return {
        ...observation,
        menuInspectionError: "The selected menu can no longer be inspected.",
      };
    }
    try {
      const report = await computer.inspectMenu(
        {
          kind: "inspect_menu",
          pid: selected.pid,
          window_id: selected.window_id,
          topLevel: selected.topLevel,
          reason: `Inspect observed ${JSON.stringify(selected.topLevel)} menu commands`,
        },
        window,
      );
      if (
        report.pid !== selected.pid ||
        report.window_id !== selected.window_id ||
        report.topLevel !== selected.topLevel
      ) {
        this.clearMenuInspection();
        return {
          ...observation,
          menuInspectionError: "The refreshed menu belongs to another window or menu.",
        };
      }
      const menus = [
        ...(window.menus ?? []).filter((menu) => menu.path[0] !== selected.topLevel),
        ...report.menus,
      ];
      return { ...observation, window: { ...window, menus }, menuInspection: report };
    } catch (error) {
      this.clearMenuInspection();
      return {
        ...observation,
        menuInspectionError: `Could not refresh the selected menu: ${error instanceof Error ? error.message.slice(0, MENU_ERROR_CHARS) : "inspection failed"}`,
      };
    }
  }
  private async readTarget(
    computer: Readonly<ManagedComputer>,
    observation: Observation,
    target: Target,
  ): Promise<Observation> {
    try {
      return await this.withMenuInspection(computer, {
        ...observation,
        window: await computer.window(target.pid, target.windowId),
      });
    } catch (error) {
      if (!(error instanceof WindowUnavailableError)) {
        throw error;
      }
    }
    // Window replacement can precede its Accessibility tree. Rediscover once;
    // Multiple candidates must go back to the decision model for selection.
    this.setTarget(undefined);
    const desktop = await computer.desktop();
    const application = desktop.apps.find((app) => app.pid === target.pid);
    const fresh: Observation = { desktop, ...(application === undefined ? {} : { application }) };
    const windows = desktop.windows.filter((window) => window.pid === target.pid);
    const [replacement] = windows;
    if (windows.length !== 1 || replacement === undefined) {
      return fresh;
    }
    try {
      const window = await computer.window(replacement.pid, replacement.window_id);
      this.setTarget({ pid: replacement.pid, windowId: replacement.window_id });
      return { ...fresh, window };
    } catch (error) {
      if (!(error instanceof WindowUnavailableError)) {
        throw error;
      }
      return fresh;
    }
  }
  public async observe(
    getComputer: (mode: "browser" | "desktop") => ManagedComputer,
  ): Promise<Observation> {
    const computer = getComputer(this.mode ?? "desktop");
    const desktop = await computer.desktop();
    if (this.mode === "browser") {
      return { desktop, window: await computer.window(0, 0) };
    }
    if (this.needsApplication) {
      return { desktop };
    }
    const application = desktop.apps.find(
      (app) => app.pid === (this.application?.pid ?? this.target?.pid),
    );
    const windows = desktop.windows.filter((window) => window.pid === application?.pid);
    if (
      this.target !== undefined &&
      !desktop.windows.some(
        (window) => window.pid === this.target?.pid && window.window_id === this.target.windowId,
      )
    ) {
      this.setTarget(undefined);
    }
    if (this.target === undefined && windows.length === 1 && windows[0] !== undefined) {
      this.setTarget({ pid: windows[0].pid, windowId: windows[0].window_id });
    }
    const { target } = this;
    if (
      target !== undefined &&
      desktop.windows.some(
        (window) => window.pid === target.pid && window.window_id === target.windowId,
      )
    ) {
      return this.readTarget(
        computer,
        {
          desktop,
          ...(application === undefined ? {} : { application }),
        },
        target,
      );
    }
    this.setTarget(undefined);
    return { desktop, ...(application === undefined ? {} : { application }) };
  }
  public async select(
    mode: "browser" | "desktop",
    computer: Readonly<ManagedComputer>,
    saved: Surface | undefined,
  ): Promise<void> {
    this.clearMenuInspection();
    this.mode = mode;
    this.target = mode === "desktop" ? this.desktopTarget : undefined;
    if (saved?.kind === mode && !this.restoreAttempts.has(mode)) {
      this.restoreAttempts.add(mode);
      this.setTarget(await restoreSurface(computer, saved));
    }
    this.needsApplication = mode === "desktop" && this.target === undefined;
  }
}
async function verifyFocusedKeyTarget(
  computer: Readonly<Computer>,
  action: Extract<Action, { kind: "press_key" }>,
  context: { readonly observation: Observation; readonly signal?: Readonly<AbortSignal> },
): Promise<void> {
  const { observation, signal } = context;
  const selected = observation.window?.elements.filter((element) => element.focused === true);
  if (selected?.length !== 1 || selected[0]?.element_token !== action.element_token) {
    throw new Error("The selected key target no longer has unique focus.");
  }
  const initialKey = textFieldKey(observation, action.element_token);
  const fresh = await computer.window(action.pid, action.window_id);
  const focused = fresh.elements.filter(
    (element) => element.focused === true && element.enabled !== false,
  );
  const freshKey =
    focused[0] === undefined
      ? undefined
      : textFieldKey({ ...observation, window: fresh }, focused[0].element_token);
  if (
    fresh.pid !== action.pid ||
    fresh.window_id !== action.window_id ||
    focused.length !== 1 ||
    initialKey === undefined ||
    initialKey !== freshKey
  ) {
    throw new Error("The focused control changed before key input. Observe the window again.");
  }
  signal?.throwIfAborted();
}
async function executeInput(
  computer: Readonly<Computer>,
  action: Action,
  context: { readonly observation: Observation; readonly signal?: Readonly<AbortSignal> },
): Promise<void> {
  switch (action.kind) {
    case "click_element": {
      await computer.clickElement(action);
      break;
    }
    case "type_text": {
      await computer.typeText(action);
      break;
    }
    case "press_key": {
      await verifyFocusedKeyTarget(computer, action, context);
      context.signal?.throwIfAborted();
      await computer.pressKey(action);
      break;
    }
    case "invoke_menu": {
      if (computer.invokeMenu === undefined) {
        throw new Error("This driver cannot invoke native menu commands");
      }
      await computer.invokeMenu(action);
      break;
    }
    case "inspect_menu": {
      throw new Error("Menu inspection requires the read-only action handler.");
    }
    case "navigate": {
      if (computer.navigate === undefined) {
        throw new Error("Navigation requires Chrome tools");
      }
      await computer.navigate(action.url);
      break;
    }
    case "blocked":
    case "compose_text":
    case "finish":
    case "observe_window":
    case "refresh":
    case "request_url":
    case "request_app":
    case "select_surface": {
      break;
    }
  }
}
export { SurfaceSession, executeInput, restoreSurface };
