import { createInterface } from "node:readline";
import type { Interface } from "node:readline";
import type { Readable } from "node:stream";
import type { ReadonlyDeep } from "type-fest";

interface ReadinessOptions {
  readonly message: string;
  readonly signal: ReadonlyDeep<AbortSignal>;
  readonly timeoutMs: number;
}
class Readiness {
  private readonly completion = Promise.withResolvers<string | undefined>();
  public readonly result = this.completion.promise;
  private readonly lines: Interface;
  private readonly options: ReadinessOptions;
  private readonly timer: ReturnType<typeof setTimeout>;
  private settled = false;
  private readonly abort = (): void => {
    this.finish("Model loading cancelled");
  };
  public constructor(stream: ReadonlyDeep<Readable>, options: ReadinessOptions) {
    this.options = options;
    this.lines = createInterface({ input: stream });
    this.timer = setTimeout(() => {
      this.finish("Model loading timed out. Check its log and retry.");
    }, options.timeoutMs);
    this.lines.on("line", (line) => {
      if (line.includes(options.message)) {
        this.finish();
      }
    });
    // Closing readline pauses its input. Keep draining server logs after readiness.
    this.lines.once("close", () => {
      stream.resume();
    });
    options.signal.addEventListener("abort", this.abort, { once: true });
    if (options.signal.aborted) {
      this.abort();
    }
  }
  public finish(error?: string): void {
    if (this.settled) {
      return;
    }
    this.settled = true;
    clearTimeout(this.timer);
    this.options.signal.removeEventListener("abort", this.abort);
    this.lines.close();
    this.completion.resolve(error);
  }
}
export { Readiness };
export type { ReadinessOptions };
