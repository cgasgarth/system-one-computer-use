import type { Desktop, Window } from "../agent/contracts.ts";
import { CuaConnection } from "./connection.ts";
import { taskDesktop } from "./targets.ts";
import type { ClickAction, ClickInspection, Computer, KeyAction, TypeAction } from "./types.ts";
import { CuaError } from "./errors.ts";
import { DEFAULT_NATIVE_ACCESS, readWritableFields, waitForNativeWindow } from "./native-access.ts";
import { activeWindowElements } from "./native-scope.ts";

const HALF = 2;
const ERROR_LIMIT = 400;
const FRAME_TOLERANCE = 1;

async function openMacApplication(name: string): Promise<void> {
  const process = Bun.spawn(["/usr/bin/open", "-a", name], { stdout: "ignore", stderr: "pipe" });
  const [status, error] = await Promise.all([process.exited, new Response(process.stderr).text()]);
  if (status !== 0) {
    throw new CuaError(`Could not open ${name}: ${error.trim().slice(0, ERROR_LIMIT)}`);
  }
}

function withTextCapability(
  element: Window["elements"][number],
  fields: Awaited<ReturnType<typeof readWritableFields>>["fields"],
): Window["elements"][number] {
  if (!["AXTextArea", "AXTextField", "AXComboBox"].includes(element.role)) {
    return element;
  }
  const { frame } = element;
  const matches = fields.filter(
    (field) =>
      frame !== undefined &&
      field.role === element.role &&
      Math.abs(field.frame.x - frame.x) < FRAME_TOLERANCE &&
      Math.abs(field.frame.y - frame.y) < FRAME_TOLERANCE &&
      Math.abs(field.frame.w - frame.w) < FRAME_TOLERANCE &&
      Math.abs(field.frame.h - frame.h) < FRAME_TOLERANCE,
  );
  const [field] = matches;
  if (matches.length !== 1 || field === undefined) {
    return { ...element, editable: false };
  }
  return {
    ...element,
    editable: field.editable,
    ...(field.value === undefined ? {} : { value: field.value }),
    ...(field.placeholder === undefined ? {} : { placeholder: field.placeholder }),
    ...(field.focused === undefined ? {} : { focused: field.focused }),
  };
}

class CuaMcpComputer implements Computer {
  private readonly connection: CuaConnection;
  private readonly nativeAccess: string;

  public constructor(binary = "cua-driver", nativeAccess = DEFAULT_NATIVE_ACCESS) {
    this.connection = new CuaConnection(binary);
    this.nativeAccess = nativeAccess;
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
    const visible: Window = {
      ...snapshot,
      elements: activeWindowElements(snapshot).filter((element) => {
        const { frame } = element;
        if (!frame || frame.w <= 1 || frame.h <= 1) {
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
    if (
      !visible.elements.some((element) =>
        ["AXTextArea", "AXTextField", "AXComboBox"].includes(element.role),
      )
    ) {
      return visible;
    }
    const capabilities = await readWritableFields(this.nativeAccess, visible);
    return {
      ...visible,
      elements: visible.elements.map((element) => withTextCapability(element, capabilities.fields)),
    };
  }

  public async launchApp(name: string): Promise<void> {
    await waitForNativeWindow({
      binary: this.nativeAccess,
      application: name,
      mode: "available",
      act: async () => openMacApplication(name),
    });
  }
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
    await waitForNativeWindow({
      binary: this.nativeAccess,
      application: application.name,
      mode: "created",
      act: async () => this.connection.openDocument(application.pid),
    });
    return this.openedWindow(before);
  }
  private async openedWindow(before: Desktop): Promise<Desktop["windows"][number] | undefined> {
    const after = await this.desktop();
    const created = after.windows.filter(
      (window) => !before.windows.some((previous) => previous.window_id === window.window_id),
    );
    if (created.length === 1) {
      return created[0];
    }
    return undefined;
  }

  public async clickElement(action: ClickAction): Promise<void> {
    await this.connection.click(action);
  }
  // Native AX does not expose web form submission metadata.
  // eslint-disable-next-line eslint/class-methods-use-this, typescript/promise-function-async
  public inspectClick(): Promise<ClickInspection> {
    return Promise.resolve({ kind: "unclassified" });
  }

  public async typeText(action: TypeAction): Promise<void> {
    await this.connection.typeText(action);
  }

  public async pressKey(action: KeyAction): Promise<void> {
    await this.connection.pressKey(action);
  }
}

export { CuaMcpComputer };
