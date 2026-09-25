import type { Computer, ManagedComputer } from "../computer/types.ts";
import type { Action, Desktop, Observation } from "./contracts.ts";
import type { Surface } from "../app/sessions/schema.ts";
import { restoreSurface } from "../app/sessions/targets.ts";

interface Target {
  readonly pid: number;
  readonly windowId: number;
}
class SurfaceSession {
  public mode: "browser" | "desktop" | undefined;
  public target: Target | undefined = undefined;
  public choosingWindow = false;
  private application: Desktop["apps"][number] | undefined;
  private desktopTarget: Target | undefined;
  private readonly restored = new Set<string>();
  private documentWindow: { readonly applicationPid: number; readonly target: Target } | undefined;
  public rememberDocumentWindow(applicationPid: number, window: Desktop["windows"][number]): void {
    this.documentWindow = {
      applicationPid,
      target: { pid: window.pid, windowId: window.window_id },
    };
    this.setTarget(this.documentWindow.target);
  }
  public documentTarget(applicationPid: number, observation: Observation): Target | undefined {
    const saved = this.documentWindow;
    return saved?.applicationPid === applicationPid &&
      observation.desktop.windows.some(
        (window) => window.pid === saved.target.pid && window.window_id === saved.target.windowId,
      )
      ? saved.target
      : undefined;
  }
  public setTarget(target: Target | undefined): void {
    this.target = target;
    if (target !== undefined) {
      this.choosingWindow = false;
    }
    if (this.mode === "desktop") {
      this.desktopTarget = target;
    }
  }
  public chooseWindow(): void {
    this.target = undefined;
    this.choosingWindow = true;
  }
  public selectApplication(application: Desktop["apps"][number] | undefined): void {
    this.application = application;
    this.choosingWindow = false;
  }
  public async observe(
    getComputer: (mode: "browser" | "desktop") => ManagedComputer,
  ): Promise<Observation> {
    const computer = getComputer(this.mode ?? "desktop");
    const desktop = await computer.desktop();
    if (this.mode === "browser") {
      return { desktop, window: await computer.window(0, 0) };
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
    if (
      !this.choosingWindow &&
      this.target === undefined &&
      windows.length === 1 &&
      windows[0] !== undefined
    ) {
      this.setTarget({ pid: windows[0].pid, windowId: windows[0].window_id });
    }
    const { target } = this;
    if (
      target !== undefined &&
      desktop.windows.some(
        (window) => window.pid === target.pid && window.window_id === target.windowId,
      )
    ) {
      return {
        desktop,
        ...(application === undefined ? {} : { application }),
        window: await computer.window(target.pid, target.windowId),
      };
    }
    this.setTarget(undefined);
    return { desktop, ...(application === undefined ? {} : { application }) };
  }
  public async select(
    mode: "browser" | "desktop",
    computer: Readonly<ManagedComputer>,
    saved: Surface | undefined,
  ): Promise<void> {
    this.mode = mode;
    this.choosingWindow = false;
    this.target = mode === "desktop" ? this.desktopTarget : undefined;
    if (saved?.kind === mode && !this.restored.has(mode)) {
      try {
        this.setTarget(await restoreSurface(computer, saved));
        this.restored.add(mode);
      } catch (error) {
        this.mode = undefined;
        throw error;
      }
    }
  }
}
async function executeInput(computer: Readonly<Computer>, action: Action): Promise<void> {
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
      await computer.pressKey(action);
      break;
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
    case "request_window":
    case "open_document":
    case "select_surface": {
      break;
    }
  }
}
export { SurfaceSession, executeInput };
