import { z } from "zod";
import { windowSchema } from "../../agent/contracts.ts";
import type { Action, Desktop, Surface, Window } from "../../agent/contracts.ts";
import type { ClickAction, KeyAction, ManagedComputer, TypeAction } from "../types.ts";
import { ChromeWire } from "./wire.ts";
import { axIndex, parseAxWindow } from "./snapshot.ts";
import { bookmarkTab, restoreTab, tabSchema } from "./tabs.ts";

const pageSchema = z.object({
  state: z.string(),
  url: z.string(),
  title: z.string(),
  tabId: z.string(),
});
const fieldSchema = z.object({
  tagName: z.string(),
  inputType: z.string().nullable(),
  formRole: z.string().nullable(),
  formMethod: z.string().nullable(),
});
const selectSchema = z.array(
  z.object({
    label: z.string(),
    options: z.array(
      z.object({
        label: z.string(),
        value: z.string(),
        selected: z.boolean(),
        disabled: z.boolean(),
      }),
    ),
  }),
);
const keyNames: Readonly<Record<string, string>> = {
  return: "Return",
  escape: "Escape",
  tab: "Tab",
  down: "Down",
  up: "Up",
};
const modifiers: Readonly<Record<string, string>> = {
  cmd: "super",
  ctrl: "ctrl",
  option: "alt",
  shift: "shift",
  fn: "fn",
};
interface SelectChoice {
  readonly control: string;
  readonly label: string;
  readonly value: string;
}
interface ChromeOptions {
  readonly signal?: Readonly<AbortSignal>;
  readonly wire?: ChromeControl;
}
interface ChromeControl {
  readonly ready: () => Promise<void>;
  readonly read: <Output>(
    code: string,
    schema: z.ZodType<Output>,
    title: string,
  ) => Promise<Output>;
  readonly act: (code: string, title: string) => Promise<void>;
  readonly close: () => Promise<void>;
}

function locator(element: Window["elements"][number]): string {
  return `s1Tab.playwright.getByRole(${JSON.stringify(element.role)}, {name:${JSON.stringify(element.label ?? "")},exact:true})`;
}

function selectToken(control: string, index: number): string {
  return `option:${encodeURIComponent(control)}:${index}`;
}

class CodexChromeComputer implements ManagedComputer {
  private readonly wire: ChromeControl;
  private readonly ownsWire: boolean;
  private tab: z.infer<typeof tabSchema> | undefined;
  private preparing: Promise<z.infer<typeof tabSchema>> | undefined;
  private latest: Window | undefined;
  private readonly choices = new Map<string, SelectChoice>();

  public constructor(options: Readonly<ChromeOptions>) {
    this.wire = options.wire ?? new ChromeWire(options);
    this.ownsWire = options.wire === undefined;
  }

  private async taskTab(): Promise<z.infer<typeof tabSchema>> {
    if (this.tab !== undefined) {
      return this.tab;
    }
    this.preparing ??= this.createTaskTab();
    return this.preparing;
  }

  private async createTaskTab(): Promise<z.infer<typeof tabSchema>> {
    try {
      const tab = await this.wire.read(
        "s1Tab = await s1Chrome.tabs.new(); return {browserId:s1Chrome.browserId,tabId:s1Tab.id};",
        tabSchema,
        "Create task Chrome tab",
      );
      this.tab = tab;
      return tab;
    } finally {
      this.preparing = undefined;
    }
  }

  public async desktop(): Promise<Desktop> {
    await this.taskTab();
    const title = this.latest?.window_title ?? "Task Chrome tab";
    return {
      apps: [{ bundle_id: "com.google.Chrome", name: "Google Chrome", pid: 0 }],
      windows: [{ app_name: "Google Chrome", pid: 0, window_id: 0, title }],
    };
  }

  public async window(): Promise<Window> {
    await this.taskTab();
    const page = await this.wire.read(
      "return {state:await s1Tab.ax.get('state',{disableDiffing:true}),url:(await s1Tab.url()) ?? 'about:blank',title:(await s1Tab.title()) ?? '',tabId:s1Tab.id};",
      pageSchema,
      "Read task Chrome tab",
    );
    if (page.tabId !== this.tab?.tabId) {
      throw new Error("Chrome changed the task tab. Observe it again.");
    }
    const checked = windowSchema.safeParse(parseAxWindow(page));
    if (!checked.success) {
      const [issue] = checked.error.issues;
      throw new Error(
        `Chrome observation is invalid at ${issue?.path.join(".") ?? "window"}: ${issue?.message ?? "invalid value"}. Observe the tab again.`,
      );
    }
    const base = checked.data;
    this.choices.clear();
    this.latest = await this.withSelectOptions(base);
    return this.latest;
  }

  private async withSelectOptions(window: Window): Promise<Window> {
    const controls = window.elements.filter((element) => element.role === "combobox");
    if (controls.length === 0) {
      return window;
    }
    const selects = await this.wire.read(
      `return await s1Tab.playwright.evaluate(() => Array.from(document.querySelectorAll('select')).filter((item) => item.getClientRects().length > 0).map((item) => {const label=item.labels?.[0];const name=(item.getAttribute('aria-label')??(label?Array.from(label.childNodes).filter((node)=>node.nodeType===3).map((node)=>node.textContent??'').join(''):'')).trim();return {label:name,options:Array.from(item.options).map((option) => ({label:option.label,value:option.value,selected:option.selected,disabled:option.disabled}))};}));`,
      selectSchema,
      "Read native dropdown options",
    );
    const expanded: Window["elements"][number][] = [...window.elements];
    let nextIndex = Math.max(0, ...expanded.map((element) => element.element_index)) + 1;
    for (const select of selects) {
      const matches = controls.filter((element) => element.label === select.label);
      const [parent] = matches;
      if (matches.length === 1 && parent !== undefined) {
        for (const [index, option] of select.options.entries()) {
          const token = selectToken(parent.element_token, index);
          if (select.options.filter((entry) => entry.value === option.value).length === 1) {
            this.choices.set(token, {
              control: select.label,
              label: option.label,
              value: option.value,
            });
          }
          expanded.push({
            element_index: nextIndex,
            element_token: token,
            parent_index: parent.element_index,
            role: "option",
            label: option.label,
            value: option.value,
            selected: option.selected,
            enabled: !option.disabled,
            actions:
              option.selected ||
              option.disabled ||
              select.options.filter((entry) => entry.value === option.value).length !== 1
                ? []
                : ["AXPick"],
          });
          nextIndex += 1;
        }
      }
    }
    return { ...window, elements: expanded };
  }

  public async bookmark(): Promise<Extract<Surface, { kind: "browser" }>> {
    const tab = await this.taskTab();
    return bookmarkTab(this.wire, tab);
  }

  public async restore(surface: Extract<Surface, { kind: "browser" }>): Promise<void> {
    this.tab = await restoreTab(this.wire, surface);
    this.latest = undefined;
    this.choices.clear();
  }

  public async launchApp(): Promise<void> {
    await this.taskTab();
  }

  public async navigate(url: string): Promise<void> {
    await this.taskTab();
    await this.wire.act(`await s1Tab.goto(${JSON.stringify(url)})`, "Open URL in task tab");
    this.latest = undefined;
    this.choices.clear();
  }

  private observed(token: string, capability: string): Window["elements"][number] {
    const element = this.latest?.elements.find((item) => item.element_token === token);
    if (
      element === undefined ||
      element.enabled === false ||
      element.actions?.includes(capability) !== true
    ) {
      throw new Error("The Chrome control changed. Observe the tab again.");
    }
    return element;
  }

  public async clickElement(action: ClickAction): Promise<void> {
    const capability = {
      press: "AXPress",
      pick: "AXPick",
      confirm: "AXConfirm",
      open: "AXOpen",
    }[action.operation ?? "press"];
    this.observed(action.element_token, capability);
    const choice = this.choices.get(action.element_token);
    if (choice !== undefined) {
      const code = `var s1Select = s1Tab.playwright.getByRole('combobox',{name:${JSON.stringify(choice.control)},exact:true}); if(await s1Select.count()!==1) throw new Error('Dropdown is ambiguous'); await s1Select.selectOption({value:${JSON.stringify(choice.value)}})`;
      await this.wire.act(code, "Choose observed dropdown option");
      this.latest = undefined;
      this.choices.clear();
      return;
    }
    await this.wire.act(
      `await s1Tab.ax.click(${axIndex(action.element_token)})`,
      "Activate Chrome control",
    );
    this.latest = undefined;
    this.choices.clear();
  }

  public async inspectField(
    action: Extract<Action, { kind: "compose_text" }>,
  ): Promise<z.infer<typeof fieldSchema>> {
    const element = this.latest?.elements.find(
      (item) => item.element_token === action.element_token,
    );
    if (element === undefined) {
      throw new Error("The Chrome field changed. Observe it again.");
    }
    return this.wire.read(
      `var s1Locator=${locator(element)}; if(await s1Locator.count()!==1) throw new Error('Field is ambiguous'); return await s1Locator.evaluate((item) => {const tag=item.tagName.toLowerCase();const form=item.closest('form');return {tagName:tag,inputType:tag==='input'?(item.getAttribute('type')??'text'):null,formRole:form?.getAttribute('role')??null,formMethod:form?.getAttribute('method')??null};});`,
      fieldSchema,
      "Inspect Chrome text field",
    );
  }

  public async typeText(action: TypeAction): Promise<void> {
    this.observed(action.element_token, "AXSetValue");
    await this.wire.act(
      `await s1Tab.ax.setValue(${axIndex(action.element_token)},${JSON.stringify(action.text)})`,
      "Enter text in Chrome field",
    );
    this.latest = undefined;
    this.choices.clear();
  }

  public async pressKey(action: KeyAction): Promise<void> {
    const focused = this.latest?.elements.filter((element) => element.focused === true);
    if (focused?.length !== 1 || focused[0]?.element_token !== action.element_token) {
      throw new Error("The Chrome key target changed. Observe the tab again.");
    }
    const key = [
      ...action.modifiers.map((modifier) => modifiers[modifier] ?? modifier),
      keyNames[action.key] ?? action.key,
    ].join("+");
    await this.wire.act(
      `await s1Tab.ax.pressKey(${axIndex(action.element_token)},${JSON.stringify(key)})`,
      "Press Chrome key",
    );
    this.latest = undefined;
    this.choices.clear();
  }

  public async close(): Promise<void> {
    if (this.ownsWire) {
      await this.wire.close();
    }
  }
}

export { CodexChromeComputer };
export type { ChromeOptions };
