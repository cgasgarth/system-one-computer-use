import type { Computer, ManagedComputer } from "../computer/types.ts";
import type { Action, Observation } from "./contracts.ts";
import type { Surface } from "../app/sessions/schema.ts";
import { restoreSurface } from "../app/sessions/targets.ts";

interface Target {
  readonly pid: number;
  readonly windowId: number;
}
class SurfaceSession {
  public mode: "browser" | "desktop" | undefined;
  public target: Target | undefined = undefined;
  private desktopTarget: Target | undefined;
  private readonly restored = new Set<string>();
  public setTarget(target: Target | undefined): void {
    this.target = target;
    if (this.mode === "desktop") {
      this.desktopTarget = target;
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
    const { target } = this;
    if (
      target !== undefined &&
      desktop.windows.some(
        (window) => window.pid === target.pid && window.window_id === target.windowId,
      )
    ) {
      return { desktop, window: await computer.window(target.pid, target.windowId) };
    }
    this.setTarget(undefined);
    return { desktop };
  }
  public async select(
    mode: "browser" | "desktop",
    computer: Readonly<ManagedComputer>,
    saved: Surface | undefined,
  ): Promise<void> {
    this.mode = mode;
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
    case "launch_app": {
      await computer.launchApp(action.name);
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
export { SurfaceSession, executeInput };
