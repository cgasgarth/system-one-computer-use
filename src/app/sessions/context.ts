import type { Session } from "./schema.ts";

const REQUEST_CHARS = 500;
const PREVIOUS_TURN = -2;
function sessionContext(session: Session): string {
  const turn = session.turns.at(PREVIOUS_TURN);
  if (turn === undefined) {
    return "";
  }
  return `Previous request (historical context only): ${JSON.stringify(turn.task.slice(0, REQUEST_CHARS))}\nPrevious target (historical, not evidence of the current state): ${JSON.stringify(session.surface)}\nThe current request takes priority. Use history only to resolve references in the current request.`;
}
export { sessionContext };
