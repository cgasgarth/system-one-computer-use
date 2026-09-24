import type { Observation, TaskPlan, Window } from "./contracts.ts";
import type { Progress } from "./types.ts";
import { appNameMatches } from "./app-name.ts";

function matchesPlan(plan: TaskPlan, window: Window, progress: Progress): boolean {
  const title = window.window_title.toLocaleLowerCase();
  const { targetLabel, textToEnter } = plan;
  if (plan.goal === "enter_text" && textToEnter !== undefined) {
    return (
      progress.textEntry?.text === textToEnter &&
      window.elements.some(
        (element) =>
          element.value === textToEnter &&
          element.label === progress.textEntry?.label &&
          (element.actions ?? []).includes("AXSetValue"),
      )
    );
  }
  if (targetLabel !== undefined) {
    return (
      (progress.hasTaskAction && title.includes(targetLabel.toLocaleLowerCase())) ||
      (progress.hasNavigated &&
        progress.clickedTargetBeforeTitle !== undefined &&
        window.window_title !== progress.clickedTargetBeforeTitle)
    );
  }
  return false;
}

function taskLooksComplete(plan: TaskPlan, observation: Observation, progress: Progress): boolean {
  const { window } = observation;
  if (window === undefined) {
    return false;
  }
  if (plan.goal === "open_website") {
    if (!progress.hasTaskAction || window.url === undefined || window.url === plan.url) {
      return false;
    }
    const name = plan.website.toLocaleLowerCase().replaceAll(/\s/gu, "");
    const title = window.window_title.toLocaleLowerCase().replaceAll(/\s/gu, "");
    const host = new URL(window.url).hostname;
    return (
      !["www.google.com", "google.com"].includes(host) &&
      (title.includes(name) || host.replaceAll(".", "").includes(name))
    );
  }
  if (plan.goal === "open_url") {
    return window.url !== undefined && new URL(window.url).href === new URL(plan.url).href;
  }
  if (plan.goal === "open_app") {
    return appNameMatches(window.app_name, plan.app);
  }
  const status = window.elements.find(
    (element) =>
      element.role === "status" &&
      ["Task pending", "Task complete", "Task failed"].includes(element.label ?? ""),
  );
  if (status !== undefined) {
    return progress.hasActed && status.label === "Task complete";
  }
  return matchesPlan(plan, window, progress);
}

export { taskLooksComplete };
