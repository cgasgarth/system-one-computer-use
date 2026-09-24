import type { Observation, TaskPlan, Window } from "./contracts.ts";
import type { Progress } from "./types.ts";

function matchesPlan(plan: TaskPlan, window: Window, progress: Progress): boolean {
  const title = window.window_title.toLocaleLowerCase();
  const { targetLabel, textToEnter } = plan;
  if (plan.goal === "enter_text" && textToEnter !== undefined) {
    return (
      progress.hasTaskAction &&
      window.elements.some(
        (element) => typeof element.value === "string" && element.value.includes(textToEnter),
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
  if (plan.goal === "open_url") {
    return window.url !== undefined && new URL(window.url).href === new URL(plan.url).href;
  }
  if (plan.goal === "open_app") {
    return window.app_name.toLocaleLowerCase() === plan.app.toLocaleLowerCase();
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
