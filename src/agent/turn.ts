import type { Action, Observation } from "./contracts.ts";
import { describeAction } from "./contracts.ts";
import type { ActionResult, TaskOptions, TaskStep } from "./types.ts";
import type { Progress } from "./progress.ts";
import type { SurfaceSession } from "./surface.ts";
import { executeInput } from "./surface.ts";
import { enterText, openApplication, openUrl } from "./input.ts";
import { options as actionOptions } from "./options.ts";
import { summarizeObservation } from "../app/sessions/context.ts";
import { stateKey } from "./state-key.ts";

const HISTORY_CHARS = 2000;
const ERROR_CHARS = 300;
const RECENT_ACTIONS = 3;
const REFRESH_WAIT_MS = 250;
interface TurnContext {
  readonly options: TaskOptions;
  readonly surfaces: Readonly<SurfaceSession>;
  readonly observation: Observation;
  readonly action: Action;
}
interface TurnInput {
  readonly progress: Readonly<Progress>;
  readonly options: TaskOptions;
  readonly surfaces: Readonly<SurfaceSession>;
  readonly history: readonly TaskStep[];
  readonly lastError: string;
  readonly started: number;
}
interface TurnResult {
  readonly step: TaskStep;
  readonly observation: Observation;
  readonly lastError: string;
}
function turnFeedback(lastError: string): string {
  return lastError.length === 0
    ? ""
    : `Last tool error: ${lastError.slice(0, ERROR_CHARS)}. Other tools remain available.`;
}
function dialogVisible(observation: Observation): boolean {
  return (
    observation.window?.elements.some((element) =>
      ["dialog", "alertdialog", "AXDialog", "AXSheet", "AXPopover"].includes(element.role),
    ) === true
  );
}
function completionEvidence(
  history: readonly TaskStep[],
  observation: Observation,
): string | undefined {
  const last = history.at(-1);
  if (last?.performedAction !== true || last.action.kind !== "click_element") {
    return undefined;
  }
  const before = last.presentedDialog;
  const after = dialogVisible(observation);
  if (before === undefined || before === after) {
    return undefined;
  }
  const written = history
    .slice(0, -1)
    .findLast(
      (step) => step.performedAction === true && step.verifiedField !== undefined,
    )?.verifiedField;
  const field =
    written === undefined
      ? ""
      : ` Before that click, a read-back confirmed ${written.role} ${JSON.stringify(written.label)} contained ${JSON.stringify(written.value)}.`;
  return `A click on ${last.control?.role ?? "control"} ${JSON.stringify(last.control?.label ?? "")} returned successfully. A subsequent observation shows the dialog changed from ${before ? "open" : "closed"} to ${after ? "open" : "closed"}.${field}`;
}
function selectedControl(action: Action, observation: Observation): TaskStep["control"] {
  if (action.kind !== "click_element") {
    return undefined;
  }
  const element = observation.window?.elements.find(
    (entry) => entry.element_token === action.element_token,
  );
  return { role: element?.role ?? "control", label: element?.label ?? "" };
}
async function openFileChooser(context: TurnContext): Promise<ActionResult> {
  const { action, surfaces, observation } = context;
  if (action.kind !== "open_document" || surfaces.mode === undefined) {
    throw new Error("Select an application before using Open");
  }
  const computer = context.options.computer(surfaces.mode);
  if (computer.openDocument === undefined) {
    throw new Error("This driver cannot use application Open commands");
  }
  const existing = surfaces.documentTarget(action.pid, observation);
  if (existing !== undefined) {
    surfaces.setTarget(existing);
    return {
      output:
        "The window produced by Open is already available. Use its controls instead of opening it again.",
      unchanged: {
        kind: "document",
        applicationPid: action.pid,
        pid: existing.pid,
        windowId: existing.windowId,
      },
    };
  }
  const opened = await computer.openDocument({ name: action.name, pid: action.pid });
  if (opened !== undefined) {
    surfaces.rememberDocumentWindow(action.pid, opened);
  }
  return {
    output: `Requested ${action.name}'s Open command. Inspect the resulting file chooser.`,
    performedAction: true,
  };
}
async function verifyBrowserClick(context: TurnContext): Promise<void> {
  if (context.action.kind !== "click_element" || context.surfaces.mode !== "browser") {
    return;
  }
  const selected = context.observation.window;
  if (selected === undefined) {
    throw new Error("The browser target is no longer available. Observe it again.");
  }
  const fresh = await context.options
    .computer("browser")
    .window(context.action.pid, context.action.window_id);
  if (
    stateKey({ ...context.observation, window: fresh }) !== stateKey(context.observation) ||
    JSON.stringify(fresh.elements.map((element) => element.element_token)) !==
      JSON.stringify(selected.elements.map((element) => element.element_token))
  ) {
    throw new Error(
      "The browser changed before the click. Observe it again and choose a fresh target.",
    );
  }
}
async function applyInput({
  options,
  surfaces,
  observation,
  action,
}: TurnContext): Promise<ActionResult> {
  if (surfaces.mode === undefined) {
    throw new Error("Select a tool set first");
  }
  const computer = options.computer(surfaces.mode);
  const input = { action, observation, options, computer };
  if (action.kind === "open_document") {
    return openFileChooser({ options, surfaces, observation, action });
  }
  if (action.kind === "compose_text") {
    return enterText(input);
  }
  if (action.kind === "request_url") {
    return openUrl(input);
  }
  if (action.kind === "request_app") {
    const opened = await openApplication(input);
    surfaces.selectApplication(opened.application);
    surfaces.setTarget(opened.target);
    if (opened.target === undefined) {
      return {
        output: `Opened ${opened.name}. Select an available window, observe again, or use another tool.`,
        performedAction: opened.unchanged === undefined,
        ...(opened.unchanged === undefined ? {} : { unchanged: opened.unchanged }),
      };
    }
    return opened.unchanged === undefined
      ? { output: `Opened ${opened.name}`, performedAction: true }
      : { output: `${opened.name} is already open and selected.`, unchanged: opened.unchanged };
  }
  await verifyBrowserClick({ options, surfaces, observation, action });
  await executeInput(computer, action);
  return { output: describeAction(action), performedAction: true };
}
async function selectSurface({ options, surfaces, action }: TurnContext): Promise<ActionResult> {
  if (action.kind !== "select_surface") {
    throw new Error("Expected a surface selection");
  }
  await surfaces.select(action.surface, options.computer(action.surface), options.previousSurface);
  const selected = await surfaces.observe(options.computer);
  if (
    action.surface === "browser" &&
    selected.window?.url === "about:blank" &&
    selected.window.elements.length === 0
  ) {
    return applyInput({
      options,
      surfaces,
      observation: selected,
      action: {
        kind: "request_url",
        reason: "Open the destination needed for the selected browser tool.",
      },
    });
  }
  if (action.surface === "desktop" && options.applications.length > 0) {
    return applyInput({
      options,
      surfaces,
      observation: selected,
      action: {
        kind: "request_app",
        reason: "Open the application needed for the selected desktop tool.",
      },
    });
  }
  return { output: `Selected ${action.surface} tools` };
}
async function act(context: TurnContext): Promise<ActionResult> {
  const { options, surfaces, observation, action } = context;
  if (action.kind === "select_surface") {
    return selectSurface(context);
  }
  if (action.kind === "observe_window") {
    if (surfaces.mode !== undefined) {
      await options.computer(surfaces.mode).focusWindow?.(action.pid, action.window_id);
    }
    surfaces.selectApplication(observation.desktop.apps.find((app) => app.pid === action.pid));
    surfaces.setTarget({ pid: action.pid, windowId: action.window_id });
    return { output: describeAction(action) };
  }
  if (action.kind === "refresh") {
    await Bun.sleep(REFRESH_WAIT_MS);
    options.signal?.throwIfAborted();
    return { output: "Waiting for the observed state to change." };
  }
  if (action.kind === "finish" || action.kind === "blocked") {
    return { output: describeAction(action) };
  }
  return applyInput({ options, surfaces, observation, action });
}
async function observe(
  input: TurnInput,
): Promise<{ observation: Observation; lastError: string; observationError?: string }> {
  try {
    return {
      observation: await input.surfaces.observe(input.options.computer),
      lastError: input.lastError,
    };
  } catch (error) {
    input.surfaces.setTarget(undefined);
    const message = error instanceof Error ? error.message : "Observation failed";
    return {
      observation: { desktop: { apps: [], windows: [] } },
      lastError: message,
      observationError: message,
    };
  }
}
async function outcome(context: TurnContext): Promise<ActionResult | { readonly error: string }> {
  try {
    return await act(context);
  } catch (error) {
    context.options.signal?.throwIfAborted();
    return { error: error instanceof Error ? error.message : "Tool failed" };
  }
}
async function verifyFinishSurface(
  input: TurnInput,
  observation: Observation,
): Promise<{ readonly error?: string; readonly observation?: Observation }> {
  try {
    const fresh = await input.surfaces.observe(input.options.computer);
    input.options.signal?.throwIfAborted();
    return stateKey(fresh) === stateKey(observation)
      ? {}
      : {
          error: "The screen changed before Finish. Observe the current result and choose again.",
          observation: fresh,
        };
  } catch (error) {
    input.options.signal?.throwIfAborted();
    return {
      error: `Could not verify the screen before Finish: ${error instanceof Error ? error.message : "Observation failed"}`,
    };
  }
}
// Trace fields record each independent model check and tool result.
// eslint-disable-next-line eslint/complexity, eslint/max-statements, eslint/max-lines-per-function
async function performTurn(input: TurnInput): Promise<TurnResult> {
  const { options, surfaces, history } = input;
  options.signal?.throwIfAborted();
  const observing = performance.now();
  const { observation, lastError, observationError } = await observe(input);
  const observationMs = performance.now() - observing;
  if (observationError === undefined) {
    input.progress.observe(observation);
  } else {
    input.progress.observeFailure(observationError);
  }
  const actions = input.progress.choices(
    actionOptions({
      mode: surfaces.mode,
      needsApplication: surfaces.needsApplication && options.applications.length > 0,
      observation,
      observationFailed: observationError !== undefined,
      applications: options.applications,
      canOpenDocument:
        surfaces.mode === "desktop" && options.computer("desktop").openDocument !== undefined,
    }),
    observation,
  );
  const context = `${turnFeedback(lastError)}\n${input.progress.context(observation)}`;
  const executed = completionEvidence(history, observation);
  const chosenComputer = surfaces.mode === undefined ? undefined : options.computer(surfaces.mode);
  const inspectClick = chosenComputer?.inspectClick.bind(chosenComputer);
  const decision = await options.decision.choose({
    task: options.task,
    observation,
    actions,
    context: options.context?.slice(0, HISTORY_CHARS) ?? "",
    feedback: context,
    ...(executed === undefined ? {} : { completionEvidence: executed }),
    ...(inspectClick === undefined ? {} : { inspectClick }),
    mode: surfaces.mode,
  });
  options.signal?.throwIfAborted();
  const acting = performance.now();
  const finishSurface =
    decision.action.kind === "finish" ? await verifyFinishSurface(input, observation) : undefined;
  const result =
    finishSurface?.error === undefined
      ? await outcome({
          options: {
            ...options,
            recentResults: history
              .slice(-RECENT_ACTIONS)
              .map((step) => step.output ?? step.error ?? step.action.reason),
          },
          surfaces,
          observation,
          action: decision.action,
        })
      : { error: finishSurface.error };
  const control = selectedControl(decision.action, observation);
  const step: TaskStep = {
    action: decision.action,
    ...(control === undefined ? {} : { control }),
    presentedDialog: dialogVisible(observation),
    decisionMs: decision.latencyMs,
    observationMs,
    actionMs: performance.now() - acting,
    elapsedMs: performance.now() - input.started,
    index: history.length + 1,
    probabilities: decision.probabilities,
    ...(decision.candidates === undefined ? {} : { candidates: decision.candidates }),
    ...(decision.operation === undefined ? {} : { operation: decision.operation }),
    ...(decision.rejectedOperations === undefined
      ? {}
      : { rejectedOperations: decision.rejectedOperations }),
    ...(decision.completion === undefined ? {} : { completion: decision.completion }),
    ...(decision.completionTarget === undefined
      ? {}
      : { completionTarget: decision.completionTarget }),
    ...(decision.completionCommit === undefined
      ? {}
      : { completionCommit: decision.completionCommit }),
    ...(decision.checks === undefined ? {} : { checks: decision.checks }),
    observation: summarizeObservation(observation),
    ...(finishSurface?.observation === undefined
      ? {}
      : { terminalObservation: summarizeObservation(finishSurface.observation) }),
    ...(observationError === undefined ? {} : { observationError }),
    ...result,
  };
  input.progress.record(step.unchanged, step.satisfiedInput);
  if (observationError === undefined) {
    input.progress.attempted(step.action, observation);
  }
  const terminal =
    decision.action.kind === "finish" ||
    decision.action.kind === "blocked" ||
    decision.action.kind === "refresh";
  return { step, observation, lastError: step.error ?? (terminal ? lastError : "") };
}
export { performTurn };
