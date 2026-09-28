import type { ComputerMode, ManagedComputer } from "../computer/types.ts";

class ComputerSessions {
  private readonly owned = new Map<ComputerMode, ManagedComputer>();
  private readonly create: (mode: ComputerMode) => ManagedComputer;
  private releasing: Promise<void> | undefined;
  private closed = false;

  public constructor(create: (mode: ComputerMode) => ManagedComputer) {
    this.create = create;
  }

  public get(mode: ComputerMode): ManagedComputer {
    if (this.closed) {
      throw new Error("Computer sessions are closed.");
    }
    if (this.releasing !== undefined) {
      throw new Error("Computer connections are still closing.");
    }
    const existing = this.owned.get(mode);
    if (existing !== undefined) {
      return existing;
    }
    const computer = this.create(mode);
    this.owned.set(mode, computer);
    return computer;
  }

  // Task cleanup releases controls; saved session context and delivered tabs remain reusable.
  // eslint-disable-next-line typescript/promise-function-async
  public release(): Promise<void> {
    if (this.releasing !== undefined) {
      return this.releasing;
    }
    const current = [...this.owned.values()];
    this.owned.clear();
    const releasing = (async (): Promise<void> => {
      try {
        const results = await Promise.allSettled(current.map(async (computer) => computer.close()));
        const failed = results.find((result) => result.status === "rejected");
        if (failed?.status === "rejected") {
          throw failed.reason;
        }
      } finally {
        this.releasing = undefined;
      }
    })();
    this.releasing = releasing;
    return this.releasing;
  }

  // eslint-disable-next-line typescript/promise-function-async
  public close(): Promise<void> {
    this.closed = true;
    return this.release();
  }
}

export { ComputerSessions };
