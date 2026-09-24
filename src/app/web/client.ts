import { taskInputSchema, taskResponseSchema } from "../task-schema.ts";

const PRECISION = 2;
const form = document.querySelector("form");
const task = document.querySelector<HTMLTextAreaElement>("#task");
const mode = document.querySelector<HTMLSelectElement>("#mode");
const button = document.querySelector<HTMLButtonElement>("#run");
const status = document.querySelector<HTMLPreElement>("#status");
if (form === null || task === null || mode === null || button === null || status === null) {
  throw new Error("Task form is incomplete");
}
const elements = { button, mode, status, task };

async function submitTask(): Promise<void> {
  elements.button.disabled = true;
  elements.status.textContent = "Working…";
  try {
    const input = taskInputSchema.parse({ mode: elements.mode.value, task: elements.task.value });
    const response = await fetch("/tasks", {
      body: JSON.stringify(input),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const result = taskResponseSchema.parse(await response.json());
    elements.status.textContent =
      result.status === "error"
        ? result.error
        : `${result.summary}\n${result.totalSeconds.toFixed(PRECISION)} s · ` +
          `${result.requestsPerSecond.toFixed(PRECISION)} decisions/s · ${result.decisions} decisions`;
  } catch {
    elements.status.textContent = "Task request failed. Check the local service and try again.";
  } finally {
    elements.button.disabled = false;
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  void submitTask();
});
