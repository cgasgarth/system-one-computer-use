import { z } from "zod";
import type { Action, Observation } from "./contracts.ts";
import type { TaskOptions } from "./types.ts";
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
async function openUrl(context: InputContext): Promise<string> {
  const { options, computer, observation } = context;
  if (computer.navigate === undefined) {
    throw new Error("Website navigation requires Chrome tools");
  }
  const text = await options.text.generate({
    task: options.task,
    context: options.context ?? "",
    observation,
    purpose: "url",
  });
  options.signal?.throwIfAborted();
  const url = z.url({ protocol: /^https?$/u }).parse(text.trim());
  await computer.navigate(url);
  return `Opened ${url}`;
}
interface OpenedApplication {
  readonly name: string;
  readonly target: { readonly pid: number; readonly windowId: number } | undefined;
}
async function openApplication(context: InputContext): Promise<OpenedApplication> {
  const { options, computer, observation } = context;
  const generated = await options.text.generate({
    task: options.task,
    context: options.context ?? "",
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
  await computer.launchApp(name);
  const desktop = await computer.desktop();
  const windows = desktop.windows.filter((window) => window.app_name === name);
  const [window] = windows;
  return {
    name,
    target:
      windows.length === 1 && window !== undefined
        ? { pid: window.pid, windowId: window.window_id }
        : undefined,
  };
}
export { enterText, openUrl, openApplication };
