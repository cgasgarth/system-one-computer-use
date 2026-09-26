import { z } from "zod";
import type { Action, Desktop, Observation, Window } from "./contracts.ts";
import { isEditableElement } from "./contracts.ts";
import { textTargetName } from "./controls.ts";
import { textFieldKey, windowScopeKey } from "./state-key.ts";
import { restoreSurface } from "../app/sessions/targets.ts";
import type { ActionResult, TaskOptions } from "./types.ts";
import type { UnchangedDestination } from "./progress.ts";
import type { Computer } from "../computer/types.ts";

interface InputContext {
  readonly action: Action;
  readonly observation: Observation;
  readonly options: TaskOptions;
  readonly computer: Readonly<Computer>;
}
async function verifyFieldValue(
  computer: Readonly<Computer>,
  expected: {
    readonly pid: number;
    readonly windowId: number;
    readonly field: Window["elements"][number];
    readonly text: string;
  },
): Promise<{
  readonly key?: string;
  readonly field: { readonly role: string; readonly label: string; readonly value: string };
}> {
  const written = await computer.window(expected.pid, expected.windowId);
  const { field, text } = expected;
  const matching = written.elements.filter(
    (entry) =>
      entry.role === field.role &&
      entry.value === text &&
      (entry.label === field.label || (field.label === field.value && entry.label === text)),
  );
  if (matching.length !== 1) {
    throw new Error(
      "The field did not show the requested value after writing. Inspect it before retrying.",
    );
  }
  const [verified] = matching;
  if (verified === undefined) {
    throw new Error("The verified field is unavailable after writing.");
  }
  const key = textFieldKey(
    { desktop: { apps: [], windows: [] }, window: written },
    verified.element_token,
  );
  return {
    ...(key === undefined ? {} : { key }),
    field: { role: verified.role, label: verified.label ?? "", value: text },
  };
}
// Text entry verifies the selected field before and after its single write.
// eslint-disable-next-line eslint/max-statements
async function enterText({
  action,
  observation,
  options,
  computer,
}: InputContext): Promise<ActionResult> {
  if (action.kind !== "compose_text") {
    throw new Error("Expected a text input action");
  }
  const selectedWindow = observation.window;
  const element = selectedWindow?.elements.find(
    (entry) => entry.element_token === action.element_token,
  );
  if (selectedWindow === undefined || element === undefined) {
    throw new Error("The selected input is no longer available");
  }
  const fieldMetadata = await computer.inspectField?.(action);
  const text = await options.text.generate({
    task: options.task,
    context: options.context ?? "",
    tool: action.reason,
    observation,
    purpose: "text",
    field: {
      role: element.role,
      label: textTargetName(element),
      value: String(element.value ?? ""),
      ...fieldMetadata,
      ...(element.placeholder === undefined ? {} : { placeholder: element.placeholder }),
    },
  });
  options.signal?.throwIfAborted();
  if (text.trim().length === 0) {
    throw new Error("No suitable text was supplied for this field");
  }
  const fresh = await computer.window(action.pid, action.window_id);
  if (windowScopeKey(fresh) !== windowScopeKey(selectedWindow)) {
    throw new Error(
      "The document changed while text was prepared. Observe the intended document again before typing.",
    );
  }
  const matches = fresh.elements.filter(
    (entry) =>
      entry.role === element.role && entry.label === element.label && entry.value === element.value,
  );
  const [field] = matches;
  if (matches.length !== 1 || field === undefined || !isEditableElement(field)) {
    throw new Error(
      "The selected input changed or no longer accepts text. Observe it again before typing.",
    );
  }
  if (field.value === text) {
    const satisfiedInput = textFieldKey({ ...observation, window: fresh }, field.element_token);
    return {
      output: "The field already contains the requested text.",
      ...(satisfiedInput === undefined ? {} : { satisfiedInput }),
    };
  }
  await computer.typeText({
    kind: "type_text",
    pid: fresh.pid,
    window_id: fresh.window_id,
    element_token: field.element_token,
    text,
    reason: action.reason,
  });
  const verified = await verifyFieldValue(computer, {
    pid: fresh.pid,
    windowId: fresh.window_id,
    field,
    text,
  });
  return {
    output: `Entered ${JSON.stringify(text)}`,
    performedAction: true,
    verifiedField: verified.field,
    ...(verified.key === undefined ? {} : { satisfiedInput: verified.key }),
  };
}
async function openUrl(context: InputContext): Promise<ActionResult> {
  const { options, computer, observation } = context;
  if (computer.navigate === undefined) {
    throw new Error("Website navigation requires Chrome tools");
  }
  const text = await options.text.generate({
    task: options.task,
    context: options.context ?? "",
    tool: context.action.reason,
    observation,
    purpose: "url",
  });
  options.signal?.throwIfAborted();
  if (text.trim().length === 0) {
    throw new Error(
      "The text helper found no URL for the current request. Choose another tool or request the missing information.",
    );
  }
  const url = z.url({ protocol: /^https?$/u }).parse(text.trim());
  const current = await computer.window(
    observation.window?.pid ?? 0,
    observation.window?.window_id ?? 0,
  );
  if (current.url !== undefined && new URL(current.url).href === new URL(url).href) {
    return {
      output: `Already at ${url}. Navigation was not repeated.`,
      unchanged: { kind: "url", url: new URL(url).href },
    };
  }
  await computer.navigate(url);
  return { output: `Opened ${url}`, performedAction: true };
}
interface OpenedApplication {
  readonly name: string;
  readonly application?: Desktop["apps"][number];
  readonly target: { readonly pid: number; readonly windowId: number } | undefined;
  readonly unchanged?: UnchangedDestination;
}
async function openApplication(context: InputContext): Promise<OpenedApplication> {
  const { options, computer, observation } = context;
  const generated = await options.text.generate({
    task: options.task,
    context: options.context ?? "",
    tool: context.action.reason,
    observation,
    purpose: "application",
    applications: options.applications,
  });
  const name = generated.trim();
  options.signal?.throwIfAborted();
  if (!options.applications.includes(name)) {
    throw new Error(
      "The text helper did not return an installed application name. Observe again or select another tool.",
    );
  }
  const before = await computer.desktop();
  const current = observation.window;
  if (
    current?.app_name === name &&
    before.windows.some(
      (window) => window.pid === current.pid && window.window_id === current.window_id,
    )
  ) {
    return {
      name,
      target: { pid: current.pid, windowId: current.window_id },
      unchanged: { kind: "application", name },
    };
  }
  await computer.launchApp(name);
  const desktop = await computer.desktop();
  const application = desktop.apps.find((app) => app.name === name);
  const windows = desktop.windows.filter((window) => window.app_name === name);
  const [window] = windows;
  const previous = options.previousSurface;
  const restored =
    previous?.kind === "desktop" && previous.app === name
      ? await restoreSurface(computer, previous)
      : undefined;
  return {
    name,
    ...(application === undefined ? {} : { application }),
    target:
      restored ??
      (windows.length === 1 && window !== undefined
        ? { pid: window.pid, windowId: window.window_id }
        : undefined),
  };
}
export { enterText, openUrl, openApplication };
