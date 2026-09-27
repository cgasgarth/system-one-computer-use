import { z } from "zod";
import type { Action, Desktop, Observation, Window } from "./contracts.ts";
import { isEditableElement } from "./contracts.ts";
import { textTargetName } from "./controls.ts";
import { targetContainerContext } from "./target-context.ts";
import { taskUrls } from "./url-addresses.ts";
import { textFieldKey, windowScopeKey } from "./state-key.ts";
import { restoreSurface } from "../app/sessions/targets.ts";
import type { ActionResult, TaskOptions } from "./types.ts";
import type { UnchangedDestination } from "./progress.ts";
import type { Computer } from "../computer/types.ts";

const webUrlSchema = z.url({ protocol: /^https?$/u });
const bareDomainSchema = z.hostname().refine((name) => name.includes("."));
const CORRECTION_CHARS = 200;
const FRAME_TOLERANCE = 1;

interface InputContext {
  readonly action: Action;
  readonly observation: Observation;
  readonly options: TaskOptions;
  readonly computer: Readonly<Computer>;
}
interface FieldBinding {
  readonly selected: Window["elements"][number];
  readonly candidate: Window["elements"][number];
  readonly selectedWindow: Window;
  readonly candidateWindow: Window;
}
function sameFieldLabel(
  selected: FieldBinding["selected"],
  candidate: FieldBinding["candidate"],
): boolean {
  return (
    selected.subrole === "AXSearchField" ||
    selected.role === "searchbox" ||
    candidate.label === selected.label ||
    (selected.label === selected.value && candidate.label === candidate.value)
  );
}
function sameFieldPosition(
  selected: FieldBinding["selected"],
  candidate: FieldBinding["candidate"],
): boolean {
  const first = selected.frame;
  const second = candidate.frame;
  return first === undefined || second === undefined
    ? selected.element_token === candidate.element_token
    : Math.abs(first.x - second.x) < FRAME_TOLERANCE &&
        Math.abs(first.y - second.y) < FRAME_TOLERANCE &&
        Math.abs(first.w - second.w) < FRAME_TOLERANCE &&
        Math.abs(first.h - second.h) < FRAME_TOLERANCE;
}
function sameFieldIdentity({
  selected,
  candidate,
  selectedWindow,
  candidateWindow,
}: FieldBinding): boolean {
  if (selected.role !== candidate.role || selected.subrole !== candidate.subrole) {
    return false;
  }
  const firstContext = targetContainerContext(selected, selectedWindow);
  const secondContext = targetContainerContext(candidate, candidateWindow);
  if (firstContext !== undefined || secondContext !== undefined) {
    return (
      firstContext !== undefined &&
      firstContext === secondContext &&
      sameFieldLabel(selected, candidate)
    );
  }
  return sameFieldPosition(selected, candidate) && sameFieldLabel(selected, candidate);
}
function uniqueSelectedField(window: Window, field: Window["elements"][number]): boolean {
  const context = targetContainerContext(field, window);
  const peers = window.elements.filter(
    (entry) =>
      entry.role === field.role &&
      entry.subrole === field.subrole &&
      entry.value === field.value &&
      (field.subrole === "AXSearchField" ||
        field.role === "searchbox" ||
        entry.label === field.label ||
        (field.label === field.value && entry.label === entry.value)) &&
      (context === undefined || targetContainerContext(entry, window) === context),
  );
  return peers.length === 1;
}
async function generateFieldText(
  context: InputContext,
  action: Extract<Action, { kind: "compose_text" }>,
  element: Window["elements"][number],
): Promise<string> {
  const metadata = await context.computer.inspectField?.(action);
  const container =
    context.observation.window === undefined
      ? undefined
      : targetContainerContext(element, context.observation.window);
  return context.options.text.generate({
    task: context.options.task,
    context: context.options.context ?? "",
    ...(context.options.signal === undefined ? {} : { signal: context.options.signal }),
    tool: action.reason,
    observation: context.observation,
    purpose: "text",
    field: {
      kind:
        element.role === "searchbox" || element.subrole === "AXSearchField" ? "search" : "general",
      role: element.role,
      ...(element.subrole === undefined ? {} : { subrole: element.subrole }),
      label: textTargetName(element),
      ...(container === undefined ? {} : { container }),
      value: String(element.value ?? ""),
      ...metadata,
      ...(element.placeholder === undefined ? {} : { placeholder: element.placeholder }),
    },
  });
}
async function verifyFieldValue(
  computer: Readonly<Computer>,
  expected: {
    readonly pid: number;
    readonly windowId: number;
    readonly field: Window["elements"][number];
    readonly sourceWindow: Window;
    readonly text: string;
    readonly scope: string;
  },
): Promise<{
  readonly key?: string;
  readonly field: { readonly role: string; readonly label: string; readonly value: string };
}> {
  const written = await computer.window(expected.pid, expected.windowId);
  if (windowScopeKey(written) !== expected.scope) {
    throw new Error("The document changed after text was entered. Inspect it before retrying.");
  }
  const { field, text } = expected;
  const matching = written.elements.filter(
    (entry) =>
      entry.value === text &&
      sameFieldIdentity({
        selected: field,
        candidate: entry,
        selectedWindow: expected.sourceWindow,
        candidateWindow: written,
      }),
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
  if (!uniqueSelectedField(selectedWindow, element)) {
    throw new Error(
      "The selected input is ambiguous among matching fields. Observe its container again before typing.",
    );
  }
  const text = await generateFieldText({ action, observation, options, computer }, action, element);
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
      entry.value === element.value &&
      sameFieldIdentity({
        selected: element,
        candidate: entry,
        selectedWindow,
        candidateWindow: fresh,
      }),
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
  options.signal?.throwIfAborted();
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
    sourceWindow: fresh,
    text,
    scope: windowScopeKey(fresh),
  });
  return {
    output: `Entered ${JSON.stringify(text)}`,
    performedAction: true,
    verifiedField: verified.field,
    ...(verified.key === undefined ? {} : { satisfiedInput: verified.key }),
  };
}
function normalizedWebUrl(text: string): string | undefined {
  const value = text.trim();
  const complete = webUrlSchema.safeParse(value);
  if (complete.success) {
    return complete.data;
  }
  const domain = bareDomainSchema.safeParse(value);
  if (!domain.success) {
    return undefined;
  }
  const normalized = webUrlSchema.safeParse(`https://${domain.data}`);
  return normalized.success ? normalized.data : undefined;
}
function taskContainsUrl(url: string, task: string): boolean {
  return taskUrls(task).includes(new URL(url).href);
}
function observedExactUrl(url: string, observation: Observation): boolean {
  const candidates = [
    observation.window?.url,
    ...(observation.window?.elements.map((element) => element.href) ?? []),
  ];
  return candidates.some((candidate) => {
    const parsed = webUrlSchema.safeParse(candidate);
    return parsed.success && new URL(parsed.data).href === new URL(url).href;
  });
}
function groundedWebUrl(url: string | undefined, context: InputContext): string | undefined {
  if (url === undefined) {
    return undefined;
  }
  const target = new URL(url);
  if (target.pathname === "/" && target.search.length === 0 && target.hash.length === 0) {
    return url;
  }
  return taskContainsUrl(url, context.options.task) || observedExactUrl(url, context.observation)
    ? url
    : target.origin;
}
async function generateWebAddress(context: InputContext, correction?: string): Promise<string> {
  const { options, observation } = context;
  try {
    return await options.text.generate({
      task: options.task,
      context: options.context ?? "",
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      tool: context.action.reason,
      observation,
      purpose: "url",
      ...(correction === undefined ? {} : { correction }),
    });
  } catch (error) {
    throw new Error(
      "Could not get a web address. Provide a full HTTP or HTTPS URL, or choose another tool.",
      { cause: error },
    );
  }
}
async function generatedWebAddress(context: InputContext): Promise<string> {
  const { options } = context;
  const text = await generateWebAddress(context);
  options.signal?.throwIfAborted();
  if (text.trim().length === 0) {
    throw new Error(
      "The text helper found no URL for the current request. Choose another tool or request the missing information.",
    );
  }
  const direct = groundedWebUrl(normalizedWebUrl(text), context);
  if (direct !== undefined) {
    return direct;
  }
  const correction = `Your previous output ${JSON.stringify(text.slice(0, CORRECTION_CHARS))} did not give a grounded web address for the selected navigation action. Return one complete HTTP or HTTPS destination URL. Preserve a page path only when it is supplied in the current request or observed in a link. Do not invent a page path. Return an empty string if unknown.`;
  const corrected = await generateWebAddress(context, correction);
  options.signal?.throwIfAborted();
  if (corrected.trim().length === 0) {
    throw new Error(
      "The text helper could not identify a web address. Provide a full HTTP or HTTPS URL, or choose another tool.",
    );
  }
  const url = groundedWebUrl(normalizedWebUrl(corrected), context);
  if (url === undefined) {
    throw new Error(
      "The text helper did not return a valid web address. Provide a full HTTP or HTTPS URL, or choose another tool.",
    );
  }
  return url;
}
async function openUrl(context: InputContext): Promise<ActionResult> {
  const { options, computer, observation } = context;
  if (computer.navigate === undefined) {
    throw new Error("Website navigation requires Chrome tools");
  }
  const url = await generatedWebAddress(context);
  options.signal?.throwIfAborted();
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
  options.signal?.throwIfAborted();
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
  if (context.action.kind !== "request_app") {
    throw new Error("Expected an installed application action");
  }
  const { name } = context.action;
  options.signal?.throwIfAborted();
  if (!options.applications.includes(name)) {
    throw new Error(
      "The selected application is not installed. Observe again and choose an available app.",
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
  options.signal?.throwIfAborted();
  await computer.launchApp(name, options.signal);
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
