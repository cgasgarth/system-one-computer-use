import type { Desktop, Window } from "../agent/contracts.ts";
import { CuaConnection } from "./connection.ts";
import { taskDesktop } from "./targets.ts";
import type { ClickAction, Computer, KeyAction, TypeAction } from "./types.ts";
import { CuaError } from "./errors.ts";

const HALF = 2;
const ERROR_LIMIT = 400;
const WINDOW_READY_MS = 1000;
const WINDOW_POLL_MS = 50;

async function openMacApplication(name: string): Promise<void> {
  const process = Bun.spawn(["/usr/bin/open", "-a", name], { stdout: "ignore", stderr: "pipe" });
  const [status, error] = await Promise.all([process.exited, new Response(process.stderr).text()]);
  if (status !== 0) {
    throw new CuaError(`Could not open ${name}: ${error.trim().slice(0, ERROR_LIMIT)}`);
  }
}

class CuaMcpComputer implements Computer {
  private readonly connection: CuaConnection;

  public constructor(binary = "cua-driver") {
    this.connection = new CuaConnection(binary);
  }

  public async close(): Promise<void> {
    await this.connection.close();
  }

  public async desktop(): Promise<Desktop> {
    return taskDesktop(await this.connection.desktop());
  }

  public async window(pid: number, windowId: number): Promise<Window> {
    const snapshot = await this.connection.window(pid, windowId);
    const root = snapshot.elements.find(
      (element) => element.role === "AXWindow" && element.frame !== undefined,
    )?.frame;
    if (!root) {
      return snapshot;
    }
    return {
      ...snapshot,
      elements: snapshot.elements.filter((element) => {
        const { frame } = element;
        if (!frame) {
          return false;
        }
        const middleX = frame.x + frame.w / HALF;
        const middleY = frame.y + frame.h / HALF;
        return (
          middleX >= root.x &&
          middleX <= root.x + root.w &&
          middleY >= root.y &&
          middleY <= root.y + root.h
        );
      }),
    };
  }

  public readonly launchApp = openMacApplication;
  public async focusWindow(pid: number, windowId: number): Promise<void> {
    await this.connection.focusWindow(pid, windowId);
  }
  public async openDocument(
    application: Desktop["apps"][number],
  ): Promise<Desktop["windows"][number] | undefined> {
    if (!(await this.connection.isActive(application.pid))) {
      await openMacApplication(application.name);
    }
    const before = await this.desktop();
    await this.connection.openDocument(application.pid);
    return this.openedWindow(before, Date.now() + WINDOW_READY_MS);
  }
  private async openedWindow(
    before: Desktop,
    deadline: number,
  ): Promise<Desktop["windows"][number] | undefined> {
    const after = await this.desktop();
    const created = after.windows.filter(
      (window) => !before.windows.some((previous) => previous.window_id === window.window_id),
    );
    if (created.length === 1) {
      return created[0];
    }
    if (Date.now() >= deadline) {
      return undefined;
    }
    await Bun.sleep(WINDOW_POLL_MS);
    return this.openedWindow(before, deadline);
  }

  public async clickElement(action: ClickAction): Promise<void> {
    await this.connection.click(action);
  }

  public async typeText(action: TypeAction): Promise<void> {
    await this.connection.typeText(action);
  }

  public async pressKey(action: KeyAction): Promise<void> {
    await this.connection.pressKey(action);
  }
}

export { CuaMcpComputer };
