import type { Action, Desktop, MenuInspection, Surface, Window } from "../agent/contracts.ts";
import { z } from "zod";

const computerModeSchema = z.enum(["browser", "desktop"]);
type ComputerMode = z.infer<typeof computerModeSchema>;

type ClickAction = Extract<Action, { kind: "click_element" }>;
type TypeAction = Extract<Action, { kind: "type_text" }>;
type KeyAction = Extract<Action, { kind: "press_key" }>;
type MenuAction = Extract<Action, { kind: "invoke_menu" }>;
type InspectMenuAction = Extract<Action, { kind: "inspect_menu" }>;
interface Computer {
  readonly desktop: () => Promise<Desktop>;
  readonly window: (pid: number, windowId: number) => Promise<Window>;
  readonly focusWindow?: (pid: number, windowId: number) => Promise<void>;
  readonly launchApp: (name: string, signal?: Readonly<AbortSignal>) => Promise<void>;
  readonly bindApp?: (name: string) => Promise<void>;
  readonly clickElement: (action: ClickAction) => Promise<void>;
  readonly inspectField?: (action: Extract<Action, { kind: "compose_text" }>) => Promise<{
    readonly tagName: string;
    readonly inputType: string | null;
    readonly formRole: string | null;
    readonly formMethod: string | null;
  }>;
  readonly typeText: (action: TypeAction) => Promise<void>;
  readonly pressKey: (action: KeyAction) => Promise<void>;
  readonly invokeMenu?: (action: MenuAction) => Promise<void>;
  readonly inspectMenu?: (
    action: InspectMenuAction,
    currentWindow?: Window,
  ) => Promise<MenuInspection>;
  readonly navigate?: (url: string) => Promise<void>;
}

interface ManagedComputer extends Computer {
  readonly bookmark?: () => Promise<Extract<Surface, { kind: "browser" }>>;
  readonly restore?: (surface: Extract<Surface, { kind: "browser" }>) => Promise<void>;
  readonly close: () => Promise<void>;
}

export { computerModeSchema };
export type {
  ClickAction,
  Computer,
  ComputerMode,
  KeyAction,
  InspectMenuAction,
  MenuAction,
  ManagedComputer,
  TypeAction,
};
