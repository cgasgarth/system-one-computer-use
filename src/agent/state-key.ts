import type { Action, Observation } from "./contracts.ts";

function stateKey(observation: Observation): string {
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
            elements: window.elements.map((element) => ({
              role: element.role,
              label: element.label,
              href: element.href,
              value: element.value,
              selected: element.selected,
              focused: element.focused,
              enabled: element.enabled,
              frame: element.frame,
            })),
          },
    ),
  ).toString();
}

function actionKey(action: Action, observation: Observation): string | undefined {
  if (action.kind === "request_window" || action.kind === "refresh") {
    return action.kind;
  }
  if (action.kind === "observe_window") {
    return JSON.stringify([action.kind, action.pid, action.window_id]);
  }
  if (action.kind === "open_document") {
    return JSON.stringify([action.kind, action.pid]);
  }
  if (action.kind === "press_key") {
    return JSON.stringify([action.kind, action.key, action.modifiers.toSorted()]);
  }
  if (
    action.kind !== "click_element" &&
    action.kind !== "type_text" &&
    action.kind !== "compose_text"
  ) {
    return undefined;
  }
  const elements = observation.window?.elements ?? [];
  const target = elements.find((element) => element.element_token === action.element_token);
  if (target === undefined) {
    return undefined;
  }
  const ordinal = elements
    .filter(
      (element) =>
        element.role === target.role &&
        element.label === target.label &&
        element.href === target.href,
    )
    .findIndex((element) => element.element_token === target.element_token);
  return JSON.stringify([
    action.kind,
    target.role,
    target.label,
    target.href,
    ordinal,
    action.kind === "type_text" ? action.text : undefined,
  ]);
}
export { stateKey, actionKey };
