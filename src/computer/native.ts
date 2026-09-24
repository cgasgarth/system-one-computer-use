import type { Desktop, Window } from "../agent/contracts.ts";
import { CuaConnection } from "./connection.ts";
import type { ClickAction, Computer, KeyAction, TypeAction } from "./types.ts";

const HALF = 2;

class CuaMcpComputer implements Computer {
  private readonly connection: CuaConnection;

  public constructor(binary = "cua-driver") {
    this.connection = new CuaConnection(binary);
  }

  public async close(): Promise<void> {
    await this.connection.close();
  }

  public async desktop(): Promise<Desktop> {
    return this.connection.desktop();
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

  public async launchApp(name: string): Promise<void> {
    await this.connection.launchApp(name);
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
