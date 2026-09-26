import type { Surface } from "../../app/sessions/schema.ts";
import { z } from "zod";
import { browserBookmark, restoreBrowser } from "./bookmark.ts";
import type { Action, Desktop, Window } from "../../agent/contracts.ts";
import type {
  ClickAction,
  ClickInspection,
  KeyAction,
  ManagedComputer,
  TypeAction,
} from "../types.ts";
import { PlaywrightConnection } from "./connection.ts";
import { parseSnapshot, selectedOption } from "./snapshot.ts";
import { closeConnectionPage, isConnectionPage } from "./tabs.ts";

const MODIFIERS = { cmd: "Meta", ctrl: "Control", option: "Alt", shift: "Shift", fn: "Fn" };
const submitMetadata = z.object({ formSubmit: z.boolean() });
const fieldMetadata = z.object({
  tagName: z.string(),
  inputType: z.string().nullable(),
  formRole: z.string().nullable(),
  formMethod: z.string().nullable(),
});
const selectOptions = z.array(
  z.object({
    label: z.string(),
    value: z.string(),
    group: z.string().nullable(),
    selected: z.boolean(),
    disabled: z.boolean(),
  }),
);
const SUBMIT_INSPECTION =
  "(element) => { const submit = (element instanceof HTMLButtonElement || element instanceof HTMLInputElement) && element.type === 'submit' && element.form !== null; const method = submit ? (element.formMethod || element.form.method).toLowerCase() : ''; return { formSubmit: submit && method === 'post' }; }";
const FIELD_INSPECTION =
  "(element) => ({ tagName: element.tagName.toLowerCase(), inputType: element instanceof HTMLInputElement ? element.type : null, formRole: element.form?.getAttribute('role') ?? null, formMethod: element.form?.method ?? null })";
const SELECT_OPTIONS_INSPECTION =
  "(element) => element instanceof HTMLSelectElement ? Array.from(element.options, option => ({ label: option.label, value: option.value, group: option.parentElement instanceof HTMLOptGroupElement ? option.parentElement.label : null, selected: option.selected, disabled: option.disabled })) : []";

function evaluationPayload(response: string): string {
  const payload = response.split("### Result\n")[1]?.split("\n### ")[0];
  if (payload === undefined) {
    throw new Error("Playwright did not return the selected control's form metadata.");
  }
  return payload;
}
function parseSubmitResult(response: string): { readonly formSubmit: boolean } {
  return submitMetadata.parse(JSON.parse(evaluationPayload(response)));
}
function parseSelectOptions(response: string): z.infer<typeof selectOptions> {
  return selectOptions.parse(JSON.parse(evaluationPayload(response)));
}
function optionValue(
  option: Readonly<NonNullable<ReturnType<typeof selectedOption>>>,
  observed: readonly Readonly<z.infer<typeof selectOptions>[number]>[],
): string {
  const selected = observed[option.index];
  if (selected === undefined || selected.label !== option.label) {
    throw new Error("The selected option changed. Observe the dropdown again before choosing it.");
  }
  if (observed.filter((entry) => entry.value === selected.value).length !== 1) {
    throw new Error("The dropdown has duplicate option values, so this choice is ambiguous.");
  }
  return selected.value;
}
function displayOption(option: Readonly<z.infer<typeof selectOptions>[number]>): string {
  return option.group === null || option.group.length === 0
    ? option.label
    : `${option.group}: ${option.label}`;
}
function applySelectMetadata(
  window: Window,
  metadata: ReadonlyMap<string, z.infer<typeof selectOptions>>,
): Window {
  return {
    ...window,
    elements: window.elements.map((element) => {
      const choice = selectedOption(element.element_token);
      if (choice !== undefined) {
        const option = metadata.get(choice.target)?.[choice.index];
        if (option === undefined || option.label !== choice.label) {
          throw new Error("The dropdown changed while reading its options. Observe it again.");
        }
        return {
          ...element,
          label: displayOption(option),
          value: option.value,
          selected: option.selected,
          enabled: !option.disabled,
          actions: option.selected || option.disabled ? [] : ["AXPick"],
        };
      }
      const options = metadata.get(element.element_token);
      if (element.role === "combobox" && options !== undefined) {
        const selected = options.find((option) => option.selected);
        return { ...element, value: selected === undefined ? "" : displayOption(selected) };
      }
      return element;
    }),
  };
}

function browserKey(key: string): string {
  switch (key) {
    case "return": {
      return "Enter";
    }
    case "escape": {
      return "Escape";
    }
    case "tab": {
      return "Tab";
    }
    case "down": {
      return "ArrowDown";
    }
    case "up": {
      return "ArrowUp";
    }
    default: {
      return key;
    }
  }
}

class PlaywrightComputer implements ManagedComputer {
  private readonly connection: PlaywrightConnection;
  private title = "Current Chrome tab";
  private prepared: Promise<void> | undefined = undefined;

  public constructor(token?: string) {
    this.connection = new PlaywrightConnection(token);
  }

  public async close(): Promise<void> {
    await this.connection.close();
  }

  public async desktop(): Promise<Desktop> {
    await this.connection.ready();
    this.prepared ??= closeConnectionPage(this.connection);
    await this.prepared;
    return {
      apps: [{ bundle_id: "com.google.Chrome", name: "Google Chrome", pid: 0 }],
      windows: [{ app_name: "Google Chrome", pid: 0, title: this.title, window_id: 0 }],
    };
  }

  public async window(): Promise<Window> {
    let window = parseSnapshot(await this.connection.call({ name: "browser_snapshot" }));
    if (window.url !== undefined && isConnectionPage(window.url)) {
      await closeConnectionPage(this.connection);
      window = parseSnapshot(await this.connection.call({ name: "browser_snapshot" }));
    }
    const selected = await this.enrichSelects(window);
    this.title = selected.window_title;
    return selected;
  }

  private async enrichSelects(window: Window): Promise<Window> {
    const targets = new Set(
      window.elements.flatMap((element) => {
        const option = selectedOption(element.element_token);
        return option === undefined ? [] : [option.target];
      }),
    );
    if (targets.size === 0) {
      return window;
    }
    const entries = await Promise.all(
      [...targets].map(async (target) => {
        const response = await this.connection.call({
          name: "browser_evaluate",
          arguments: { target, function: SELECT_OPTIONS_INSPECTION },
        });
        return [target, parseSelectOptions(response)] as const;
      }),
    );
    return applySelectMetadata(window, new Map(entries));
  }

  public async bookmark(): Promise<Extract<Surface, { kind: "browser" }>> {
    await this.desktop();
    return browserBookmark(this.connection);
  }

  public async restore(surface: Extract<Surface, { kind: "browser" }>): Promise<void> {
    await this.desktop();
    await restoreBrowser(this.connection, surface);
  }

  public async launchApp(): Promise<void> {
    await this.connection.call({ name: "browser_tabs", arguments: { action: "list" } });
  }

  public async navigate(url: string): Promise<void> {
    await this.connection.call({ name: "browser_navigate", arguments: { url } });
  }

  public async clickElement(action: ClickAction): Promise<void> {
    const option = selectedOption(action.element_token);
    if (option !== undefined) {
      const observed = parseSelectOptions(
        await this.connection.call({
          name: "browser_evaluate",
          arguments: { target: option.target, function: SELECT_OPTIONS_INSPECTION },
        }),
      );
      const value = optionValue(option, observed);
      await this.connection.call({
        name: "browser_select_option",
        arguments: { target: option.target, values: [value] },
      });
      return;
    }
    await this.connection.call({
      name: "browser_click",
      arguments: { target: action.element_token },
    });
  }

  public async inspectClick(action: ClickAction): Promise<ClickInspection> {
    if (selectedOption(action.element_token) !== undefined) {
      return { kind: "non_submit" };
    }
    const response = await this.connection.call({
      name: "browser_evaluate",
      arguments: { target: action.element_token, function: SUBMIT_INSPECTION },
    });
    return parseSubmitResult(response).formSubmit
      ? { kind: "form_submit" }
      : { kind: "non_submit" };
  }

  public async inspectField(
    action: Extract<Action, { kind: "compose_text" }>,
  ): Promise<z.infer<typeof fieldMetadata>> {
    const response = await this.connection.call({
      name: "browser_evaluate",
      arguments: { target: action.element_token, function: FIELD_INSPECTION },
    });
    return fieldMetadata.parse(JSON.parse(evaluationPayload(response)));
  }

  public async typeText(action: TypeAction): Promise<void> {
    await this.connection.call({
      name: "browser_type",
      arguments: { target: action.element_token, text: action.text },
    });
  }

  public async pressKey(action: KeyAction): Promise<void> {
    const key = browserKey(action.key);
    await this.connection.call({
      name: "browser_press_key",
      arguments: {
        key: [...action.modifiers.map((modifier) => MODIFIERS[modifier]), key].join("+"),
      },
    });
  }
}

export {
  applySelectMetadata,
  PlaywrightComputer,
  browserKey,
  optionValue,
  parseSelectOptions,
  parseSubmitResult,
};
