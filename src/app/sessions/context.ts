import type { Observation } from "../../agent/contracts.ts";
import type { Session } from "./schema.ts";

const SNAPSHOT_CHARS = 4000;
const REQUEST_CHARS = 500;
const PREVIOUS_TURN = -2;
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
    controls: window.elements.map((element) => ({
      role: element.role,
      label: element.label,
      value: element.value,
    })),
  }).slice(0, SNAPSHOT_CHARS);
}
function sessionContext(session: Session): string {
  const turn = session.turns.at(PREVIOUS_TURN);
  if (turn === undefined) {
    return "";
  }
  return `Previous request (historical context only): ${JSON.stringify(turn.task.slice(0, REQUEST_CHARS))}\nThe current request takes priority. Use history only to resolve references in the current request.`;
}
export { summarizeObservation, sessionContext };
