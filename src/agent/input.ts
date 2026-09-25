import { z } from "zod";
import type { Action, Desktop, Observation } from "./contracts.ts";
import type { ActionResult, TaskOptions } from "./types.ts";
import type { UnchangedDestination } from "./progress.ts";
import type { Computer } from "../computer/types.ts";

interface InputContext {
  readonly action: Action;
  readonly observation: Observation;
  readonly options: TaskOptions;
  readonly computer: Readonly<Computer>;
}
async function enterText({
  action,
  observation,
  options,
  computer,
}: InputContext): Promise<string> {
  if (action.kind !== "compose_text") {
    throw new Error("Expected a text input action");
  }
  const element = observation.window?.elements.find(
    (entry) => entry.element_token === action.element_token,
  );
  if (element === undefined) {
    throw new Error("The selected input is no longer available");
  }
  const text = await options.text.generate({
    task: options.task,
    context: options.context ?? "",
    recentResults: options.recentResults ?? [],
    tool: action.reason,
    observation,
    purpose: "text",
    field: { label: element.label ?? element.role, value: String(element.value ?? "") },
  });
  options.signal?.throwIfAborted();
  if (text.trim().length === 0) {
    throw new Error("No suitable text was supplied for this field");
  }
  const fresh = await computer.window(action.pid, action.window_id);
  const matches = fresh.elements.filter(
    (entry) =>
      entry.role === element.role && entry.label === element.label && entry.value === element.value,
  );
  const [field] = matches;
  if (matches.length !== 1 || field === undefined) {
    throw new Error("The input changed while text was generated. Observe it again before typing.");
  }
  await computer.typeText({
    kind: "type_text",
    pid: fresh.pid,
    window_id: fresh.window_id,
    element_token: field.element_token,
    text,
    reason: action.reason,
  });
  return `Entered ${JSON.stringify(text)}`;
}
async function openUrl(context: InputContext): Promise<ActionResult> {
  const { options, computer, observation } = context;
  if (computer.navigate === undefined) {
    throw new Error("Website navigation requires Chrome tools");
  }
  const text = await options.text.generate({
    task: options.task,
    context: options.context ?? "",
    recentResults: options.recentResults ?? [],
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
  return { output: `Opened ${url}` };
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
    recentResults: options.recentResults ?? [],
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
  const selected = observation.application;
  if (selected?.name === name && before.apps.some((app) => app.pid === selected.pid)) {
    return {
      name,
      application: selected,
      target: current === undefined ? undefined : { pid: current.pid, windowId: current.window_id },
      unchanged: { kind: "application", name },
    };
  }
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
  return {
    name,
    ...(application === undefined ? {} : { application }),
    target:
      windows.length === 1 && window !== undefined
        ? { pid: window.pid, windowId: window.window_id }
        : undefined,
  };
}
export { enterText, openUrl, openApplication };
