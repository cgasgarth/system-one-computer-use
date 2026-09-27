import type { ComputerMode, ManagedComputer } from "../computer/types.ts";

class ComputerSessions {
  private readonly owned = new Map<ComputerMode, ManagedComputer>();
  private readonly create: (mode: ComputerMode) => ManagedComputer;
  private desktopClosing: Promise<void> | undefined;
  private closing: Promise<void> | undefined;
  private closed = false;

  public constructor(create: (mode: ComputerMode) => ManagedComputer) {
    this.create = create;
  }

  public get(mode: ComputerMode): ManagedComputer {
    if (this.closed) {
      throw new Error("Computer sessions are closed.");
    }
    if (mode === "desktop" && this.desktopClosing !== undefined) {
      throw new Error("The desktop connection is still closing.");
    }
    const existing = this.owned.get(mode);
    if (existing !== undefined) {
      return existing;
    }
    const computer = this.create(mode);
    this.owned.set(mode, computer);
    return computer;
  }

  public async closeDesktop(): Promise<void> {
    if (this.closed) {
      await this.close();
      return;
    }
    if (this.desktopClosing !== undefined) {
      await this.desktopClosing;
      return;
    }
    const desktop = this.owned.get("desktop");
    if (desktop === undefined) {
      return;
    }
    this.owned.delete("desktop");
    const closing = desktop.close();
    this.desktopClosing = closing;
    try {
      await closing;
    } finally {
      if (this.desktopClosing === closing) {
        this.desktopClosing = undefined;
      }
    }
  }

  // Return one shared promise so concurrent shutdown calls wait for the same teardown.
  // eslint-disable-next-line typescript/promise-function-async
  public close(): Promise<void> {
    if (this.closing !== undefined) {
      return this.closing;
    }
    this.closed = true;
    const current = [...this.owned.values()];
    this.owned.clear();
    const pending = this.desktopClosing;
    this.closing = (async (): Promise<void> => {
      const results = await Promise.allSettled([
        ...current.map(async (computer) => computer.close()),
        ...(pending === undefined ? [] : [pending]),
      ]);
      const failed = results.find((result) => result.status === "rejected");
      if (failed?.status === "rejected") {
        throw failed.reason;
      }
    })();
    return this.closing;
  }
}

export { ComputerSessions };
