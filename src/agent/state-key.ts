import type { Action, Observation, Window } from "./contracts.ts";
import { textTargetName } from "./controls.ts";
import { targetContainerContext } from "./target-context.ts";

// Snapshot handles can change between reads. Keep the observed document scope.
function windowScopeKey(window: Window): string {
  return JSON.stringify([
    window.app_name,
    window.pid,
    window.window_id,
    window.url,
    window.window_title,
  ]);
}

type FieldLocationParts = readonly [
  scope: string,
  role: string,
  subrole: string | undefined,
  name: string,
  container: string | undefined,
  ordinal: number,
];
interface FieldLocation {
  readonly parts: FieldLocationParts;
  readonly value: Window["elements"][number]["value"];
}
function textFieldLocation(observation: Observation, token: string): FieldLocation | undefined {
  const { window } = observation;
  const field = window?.elements.find((element) => element.element_token === token);
  if (window === undefined || field === undefined) {
    return undefined;
  }
  const name = textTargetName(field);
  const container = targetContainerContext(field, window);
  const peers = window.elements.filter(
    (element) =>
      element.role === field.role &&
      element.subrole === field.subrole &&
      textTargetName(element) === name &&
      targetContainerContext(element, window) === container,
  );
  if (
    (container === undefined && peers.length > 1) ||
    peers.filter((element) => element.value === field.value).length > 1
  ) {
    return undefined;
  }
  const ordinal = peers.findIndex((element) => element.element_token === token);
  return {
    parts: [windowScopeKey(window), field.role, field.subrole, name, container, ordinal],
    value: field.value,
  };
}
function textFieldLocationKey(observation: Observation, token: string): string | undefined {
  const location = textFieldLocation(observation, token);
  return location === undefined ? undefined : JSON.stringify(location.parts);
}
function textFieldKey(observation: Observation, token: string): string | undefined {
  const location = textFieldLocation(observation, token);
  return location === undefined ? undefined : JSON.stringify([...location.parts, location.value]);
}

function fingerprint(observation: Observation, includeTransient: boolean): string {
  const { window } = observation;
  return Bun.hash(
    JSON.stringify(
      window === undefined
        ? {
            application: observation.application,
            windows: observation.desktop.windows
              .filter(
                (entry) =>
                  observation.application === undefined ||
                  entry.pid === observation.application.pid,
              )
              .map((entry) => ({ app: entry.app_name, pid: entry.pid, id: entry.window_id })),
          }
        : {
            app: window.app_name,
            pid: window.pid,
            window: window.window_id,
            title: window.window_title,
            url: window.url,
            inspectedMenu: observation.menuInspection,
            menuInspectionError: observation.menuInspectionError,
            menus: window.menus,
            elements: window.elements.map((element) => ({
              role: element.role,
              subrole: element.subrole,
              label: element.label,
              href: element.href,
              value: element.value,
              selected: element.selected,
              enabled: element.enabled,
              focused: includeTransient ? element.focused : undefined,
              frame: includeTransient ? element.frame : undefined,
            })),
          },
    ),
  ).toString();
}

function stateKey(observation: Observation): string {
  return fingerprint(observation, true);
}

function progressStateKey(observation: Observation): string {
  return fingerprint(observation, false);
}

type ElementAction = Extract<Action, { kind: "click_element" | "type_text" | "compose_text" }>;
function elementActionKey(action: ElementAction, observation: Observation): string | undefined {
  const { window } = observation;
  const target = window?.elements.find((element) => element.element_token === action.element_token);
  if (window === undefined || target === undefined) {
    return undefined;
  }
  const container = targetContainerContext(target, window);
  const peers = window.elements.filter(
    (element) =>
      element.role === target.role &&
      element.label === target.label &&
      element.href === target.href &&
      targetContainerContext(element, window) === container,
  );
  if (container === undefined && peers.length > 1) {
    return undefined;
  }
  const ordinal = peers.findIndex((element) => element.element_token === target.element_token);
  return JSON.stringify([
    action.kind,
    action.kind === "click_element" ? (action.operation ?? "press") : undefined,
    target.role,
    target.subrole,
    target.label,
    target.href,
    container,
    ordinal,
    action.kind === "type_text" ? action.text : undefined,
  ]);
}
function actionKey(action: Action, observation: Observation): string | undefined {
  if (action.kind === "select_surface") {
    return JSON.stringify([action.kind, action.surface]);
  }
  if (action.kind === "request_app") {
    return JSON.stringify([action.kind, action.name]);
  }
  if (action.kind === "navigate") {
    return JSON.stringify([action.kind, new URL(action.url).href]);
  }
  if (action.kind === "refresh" || action.kind === "request_url") {
    return action.kind;
  }
  if (action.kind === "observe_window") {
    return JSON.stringify([action.kind, action.pid, action.window_id]);
  }
  if (action.kind === "invoke_menu") {
    return JSON.stringify([action.kind, action.pid, action.window_id, action.path]);
  }
  if (action.kind === "inspect_menu") {
    return JSON.stringify([action.kind, action.pid, action.window_id, action.topLevel]);
  }
  if (action.kind === "press_key") {
    const focus = textFieldKey(observation, action.element_token);
    return focus === undefined
      ? undefined
      : JSON.stringify([action.kind, action.key, action.modifiers.toSorted(), focus]);
  }
  return action.kind === "click_element" ||
    action.kind === "type_text" ||
    action.kind === "compose_text"
    ? elementActionKey(action, observation)
    : undefined;
}
export {
  stateKey,
  progressStateKey,
  actionKey,
  textFieldKey,
  textFieldLocationKey,
  windowScopeKey,
};
