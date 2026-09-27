import type { Desktop, Window } from "../agent/contracts.ts";
import { CuaConnection } from "./connection.ts";
import { taskDesktop } from "./targets.ts";
import type {
  ClickAction,
  ClickInspection,
  Computer,
  KeyAction,
  MenuAction,
  TypeAction,
} from "./types.ts";
import { CuaError } from "./errors.ts";
import {
  DEFAULT_NATIVE_ACCESS,
  readNativeDocument,
  readNativeMenus,
  readWritableFields,
  waitForNativeWindow,
} from "./native-access.ts";
import { activeWindowElements } from "./native-scope.ts";

const HALF = 2;
const ERROR_LIMIT = 400;
const FRAME_TOLERANCE = 1;
const TEXT_ROLES = new Set(["AXTextArea", "AXTextField", "AXComboBox"]);
const LABEL_ROLES = new Set(["AXRow", "AXCell"]);
function sameFrame(
  left: Window["elements"][number]["frame"],
  right: NonNullable<Window["elements"][number]["frame"]>,
): boolean {
  return (
    left !== undefined &&
    Math.abs(right.x - left.x) < FRAME_TOLERANCE &&
    Math.abs(right.y - left.y) < FRAME_TOLERANCE &&
    Math.abs(right.w - left.w) < FRAME_TOLERANCE &&
    Math.abs(right.h - left.h) < FRAME_TOLERANCE
  );
}
function sameMenuPath(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((part, index) => part === right[index]);
}

async function openMacApplication(name: string, signal?: Readonly<AbortSignal>): Promise<void> {
  signal?.throwIfAborted();
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
  if (!TEXT_ROLES.has(element.role)) {
    return element;
  }
  const { frame } = element;
  const matches = fields.filter(
    (field) => field.role === element.role && sameFrame(frame, field.frame),
  );
  const [field] = matches;
  if (matches.length !== 1 || field === undefined) {
    return { ...element, editable: false };
  }
  return {
    ...element,
    editable: field.editable,
    ...(field.subrole === undefined ? {} : { subrole: field.subrole }),
    ...(field.value === undefined ? {} : { value: field.value }),
    ...(field.placeholder === undefined ? {} : { placeholder: field.placeholder }),
    ...(field.focused === undefined ? {} : { focused: field.focused }),
  };
}
function withObservedLabel(
  element: Window["elements"][number],
  labels: Awaited<ReturnType<typeof readWritableFields>>["labels"],
): Window["elements"][number] {
  if (!LABEL_ROLES.has(element.role) || (element.label?.trim().length ?? 0) > 0) {
    return element;
  }
  const matches = labels.filter(
    (entry) => entry.role === element.role && sameFrame(element.frame, entry.frame),
  );
  const [match] = matches;
  return matches.length === 1 && match !== undefined ? { ...element, label: match.label } : element;
}
async function availableMetadata(
  binary: string,
  window: Window,
): Promise<Awaited<ReturnType<typeof readWritableFields>> | undefined> {
  try {
    return await readWritableFields(binary, window);
  } catch {
    return undefined;
  }
}
async function availableDocument(binary: string, window: Window): Promise<string | undefined> {
  try {
    return await readNativeDocument(binary, window);
  } catch {
    return undefined;
  }
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
    let menus: NonNullable<Window["menus"]> = [];
    try {
      menus = await readNativeMenus(this.nativeAccess, visible.pid);
    } catch {
      // A failed read cannot offer a menu action; other window controls remain usable.
    }
    const documentUrl =
      visible.url === undefined ? await availableDocument(this.nativeAccess, visible) : undefined;
    const observed: Window = {
      ...visible,
      menus,
      ...(documentUrl === undefined ? {} : { url: documentUrl }),
    };
    if (
      !observed.elements.some(
        (element) =>
          TEXT_ROLES.has(element.role) ||
          (LABEL_ROLES.has(element.role) && (element.label?.trim().length ?? 0) === 0),
      )
    ) {
      return observed;
    }
    const capabilities = await availableMetadata(this.nativeAccess, observed);
    if (capabilities === undefined) {
      return {
        ...observed,
        elements: observed.elements.map((element) =>
          TEXT_ROLES.has(element.role) ? { ...element, editable: false } : element,
        ),
      };
    }
    return {
      ...observed,
      elements: observed.elements.map((element) =>
        withObservedLabel(withTextCapability(element, capabilities.fields), capabilities.labels),
      ),
    };
  }

  public async launchApp(name: string, signal?: Readonly<AbortSignal>): Promise<void> {
    await waitForNativeWindow({
      binary: this.nativeAccess,
      application: name,
      mode: "available",
      ...(signal === undefined ? {} : { signal }),
      act: async () => openMacApplication(name, signal),
    });
  }
  public async focusWindow(pid: number, windowId: number): Promise<void> {
    await this.connection.focusWindow(pid, windowId);
  }
  public async clickElement(action: ClickAction): Promise<void> {
    await this.connection.click(action);
  }
  public async invokeMenu(action: MenuAction): Promise<void> {
    const current = await this.window(action.pid, action.window_id);
    const matches = (current.menus ?? []).filter(
      (entry) => entry.enabled && sameMenuPath(entry.path, action.path),
    );
    if (matches.length !== 1) {
      throw new CuaError(
        "The selected menu command changed or is unavailable. Observe the menu again.",
      );
    }
    await this.connection.invokeMenu(action);
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
