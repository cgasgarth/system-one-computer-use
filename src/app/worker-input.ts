import { workerInputSchema } from "./approval-protocol.ts";
import type { ApprovalResponseLine } from "./approval-protocol.ts";
import type { TaskInput } from "./task-schema.ts";

interface WorkerHandlers {
  readonly run: (task: TaskInput) => Promise<void>;
  readonly respond: (response: ApprovalResponseLine) => void;
  readonly cancel: () => void;
  readonly busy: () => void;
  readonly error: (error: unknown) => void;
  readonly stopped: () => boolean;
}

interface TaskState {
  running: Promise<void> | undefined;
}

async function runOne(
  task: TaskInput,
  handlers: Readonly<WorkerHandlers>,
  // This state must change when the concurrent task finishes.
  // eslint-disable-next-line typescript/prefer-readonly-parameter-types
  state: TaskState,
): Promise<void> {
  try {
    await handlers.run(task);
  } catch (error) {
    handlers.error(error);
  } finally {
    state.running = undefined;
  }
}

async function consumeWorkerInput(
  lines: AsyncIterable<string>,
  handlers: Readonly<WorkerHandlers>,
): Promise<void> {
  // A task runs while the input stream remains free to receive approvals.
  const state: TaskState = { running: undefined };
  try {
    for await (const line of lines) {
      if (handlers.stopped()) {
        break;
      }
      const command = workerInputSchema.parse(JSON.parse(line));
      if (command.kind === "approval_response") {
        handlers.respond(command);
      } else if (state.running === undefined) {
        state.running = runOne(command, handlers, state);
      } else {
        handlers.busy();
      }
    }
  } finally {
    if (state.running !== undefined) {
      handlers.cancel();
      await state.running;
    }
  }
}

export { consumeWorkerInput };
