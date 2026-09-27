import type { Observation } from "./contracts.ts";
import { relevantControls } from "./controls.ts";

const SNAPSHOT_CHARS = 4000;
function summarizeObservation(observation: Observation): string {
  const { window } = observation;
  if (window === undefined) {
    return observation.desktop.windows
      .map((entry) => `${entry.app_name}: ${entry.title}`)
      .join("\n")
      .slice(0, SNAPSHOT_CHARS);
  }
  return JSON.stringify({
    app: window.app_name,
    title: window.window_title,
    url: window.url,
    controls: relevantControls(window).map((element) => ({
      role: element.role,
      label: element.label,
      value: element.value,
      href: element.href,
    })),
  }).slice(0, SNAPSHOT_CHARS);
}
export { summarizeObservation };
