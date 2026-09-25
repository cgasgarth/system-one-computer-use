import type { Action, ActionChoices, Observation } from "./contracts.ts";
import { actionKey, stateKey } from "./state-key.ts";

const UNCHANGED_ATTEMPTS = 2;
const REMEMBERED_STATES = 128;
const UNCHANGED_REFRESHES = 8;

type UnchangedDestination =
  | { readonly kind: "url"; readonly url: string }
  | { readonly kind: "application"; readonly name: string }
  | {
      readonly kind: "document";
      readonly applicationPid: number;
      readonly pid: number;
      readonly windowId: number;
    };

class Progress {
  private readonly urls = new Set<string>();
  private readonly applications = new Set<string>();
  private readonly documents = new Map<
    number,
    { readonly pid: number; readonly windowId: number }
  >();
  private readonly visits = new Map<string, Map<string, number>>();
  private state: string | undefined;
  private failure: { readonly message: string; readonly count: number } | undefined;

  public observeFailure(message: string): void {
    this.failure = {
      message,
      count: this.failure?.message === message ? this.failure.count + 1 : 1,
    };
  }

  public observe(observation: Observation): void {
    this.failure = undefined;
    const current = stateKey(observation);
    if (this.state !== current) {
      this.urls.clear();
      this.applications.clear();
    }
    this.state = current;
  }

  public attempted(action: Action, observation: Observation): void {
    const key = actionKey(action, observation);
    if (key === undefined) {
      return;
    }
    const state = stateKey(observation);
    const attempts = this.visits.get(state) ?? new Map<string, number>();
    attempts.set(key, (attempts.get(key) ?? 0) + 1);
    this.visits.delete(state);
    this.visits.set(state, attempts);
    if (this.visits.size > REMEMBERED_STATES) {
      const oldest = this.visits.keys().next().value;
      if (oldest !== undefined) {
        this.visits.delete(oldest);
      }
    }
  }

  public record(destination: UnchangedDestination | undefined): void {
    if (destination?.kind === "document") {
      this.documents.set(destination.applicationPid, destination);
    }
    if (destination?.kind === "url") {
      this.urls.add(destination.url);
    }
    if (destination?.kind === "application") {
      this.applications.add(destination.name);
    }
  }

  private redundant(action: Action, observation: Observation): boolean {
    if (action.kind === "refresh" && (this.failure?.count ?? 0) >= UNCHANGED_ATTEMPTS) {
      return true;
    }
    const opened = action.kind === "open_document" ? this.documents.get(action.pid) : undefined;
    if (
      opened !== undefined &&
      observation.desktop.windows.some(
        (window) => window.pid === opened.pid && window.window_id === opened.windowId,
      )
    ) {
      return true;
    }
    const key = actionKey(action, observation);
    if (
      key !== undefined &&
      (this.visits.get(stateKey(observation))?.get(key) ?? 0) >=
        (action.kind === "refresh" ? UNCHANGED_REFRESHES : UNCHANGED_ATTEMPTS)
    ) {
      return true;
    }
    return false;
  }

  public choices(actions: ActionChoices, observation: Observation): ActionChoices {
    const [first, ...rest] = actions.filter((action) => !this.redundant(action, observation));
    if (first === undefined) {
      throw new Error("The decision is missing its terminal options");
    }
    return [
      this.describe(first, observation),
      ...rest.map((action) => this.describe(action, observation)),
    ];
  }

  private describe(action: Action, observation: Observation): Action {
    const { window } = observation;
    if (
      action.kind === "request_url" &&
      window?.url !== undefined &&
      this.urls.has(new URL(window.url).href)
    ) {
      return {
        ...action,
        reason: `Navigate to a different website. The browser is already at ${window.url}; reopening that URL has no effect.`,
      };
    }
    const app = window?.app_name ?? observation.application?.name;
    if (action.kind === "request_app" && app !== undefined && this.applications.has(app)) {
      return {
        ...action,
        reason: `Open another installed application. ${app} is already selected; reopening it has no effect.`,
      };
    }
    return action;
  }

  public context(observation: Observation): string {
    const { window } = observation;
    const completed: string[] = [];
    if ((this.failure?.count ?? 0) >= UNCHANGED_ATTEMPTS) {
      completed.push(
        "Repeated observation attempts returned the same error. Refreshing is unavailable until an observation succeeds. Change tool sets or mark the task blocked.",
      );
    }
    if (
      [...(this.visits.get(stateKey(observation))?.values() ?? [])].some(
        (count) => count >= UNCHANGED_ATTEMPTS,
      )
    ) {
      completed.push(
        "These controls were already tried in this state and the task returned here. Those repetitions are unavailable in this state; choose a different action or tools, or mark blocked if you cannot proceed.",
      );
    }
    if (window?.url !== undefined && this.urls.has(new URL(window.url).href)) {
      completed.push(
        `The browser is already at ${window.url}; repeating that navigation has no effect.`,
      );
    }
    if (window !== undefined && this.applications.has(window.app_name)) {
      completed.push(
        `${window.app_name} is already open and selected; reopening it has no effect.`,
      );
    }
    if (
      window === undefined &&
      observation.application !== undefined &&
      this.applications.has(observation.application.name)
    ) {
      completed.push(
        `${observation.application.name} is running without a controllable window. Reopening the application has no effect.`,
      );
    }
    return completed.length === 0
      ? ""
      : `${completed.join("\n")} Use the current controls, change tools, or finish if the request is satisfied.`;
  }
}
export { Progress };
export type { UnchangedDestination };
