import type { Action, Desktop, Window } from "../agent/contracts.ts";

type ClickAction = Extract<Action, { kind: "click_element" }>;
type TypeAction = Extract<Action, { kind: "type_text" }>;
type KeyAction = Extract<Action, { kind: "press_key" }>;

interface BrowserTarget {
  readonly pid: number;
  readonly tabId: string;
  readonly targetId: string;
  readonly windowId: number;
}

interface Computer {
  readonly desktop: () => Promise<Desktop>;
  readonly window: (pid: number, windowId: number) => Promise<Window>;
  readonly launchApp: (name: string) => Promise<void>;
  readonly clickElement: (action: ClickAction) => Promise<void>;
  readonly typeText: (action: TypeAction) => Promise<void>;
  readonly pressKey: (action: KeyAction) => Promise<void>;
  readonly navigate?: (url: string) => Promise<void>;
}

interface ManagedComputer extends Computer {
  readonly close: () => Promise<void>;
}

export type { BrowserTarget, ClickAction, Computer, KeyAction, ManagedComputer, TypeAction };
