import { textPrefillRequests } from "../../models/text.ts";
import type { TextRequest } from "../../models/text-schema.ts";
import { textPrefillResponseSchema } from "../../models/text-schema.ts";
import { requestUnix } from "../../models/transport/unix.ts";

const PREFILL_TIMEOUT_MS = 10_000;
type SendPrefill = (request: TextRequest, signal: Readonly<AbortSignal>) => Promise<void>;

// A loaded text process gets one best-effort system-prefix seed. Task work can cancel it.
class TextPrefill {
  private readonly send: SendPrefill;
  private completedGeneration: number | undefined = undefined;
  private pendingGeneration: number | undefined = undefined;
  private pending: Promise<void> | undefined = undefined;
  private controller: AbortController | undefined = undefined;
  private cancellationEpoch = 0;

  public constructor(options: { readonly socketPath: string; readonly send?: SendPrefill }) {
    this.send =
      options.send ??
      (async (body, signal): Promise<void> => {
        await requestUnix({
          path: options.socketPath,
          message: { role: "text", body },
          schema: textPrefillResponseSchema,
          signal: AbortSignal.any([signal, AbortSignal.timeout(PREFILL_TIMEOUT_MS)]),
        });
      });
  }

  public async start(generation: number, model: string): Promise<void> {
    const epoch = this.cancellationEpoch;
    if (this.completedGeneration === generation) {
      return;
    }
    if (this.pending !== undefined) {
      const sameGeneration = this.pendingGeneration === generation;
      await this.pending;
      if (
        epoch !== this.cancellationEpoch ||
        sameGeneration ||
        this.completedGeneration === generation
      ) {
        return;
      }
      await this.start(generation, model);
      return;
    }
    const controller = new AbortController();
    this.controller = controller;
    this.pendingGeneration = generation;
    const work = this.runSafely(generation, textPrefillRequests(model), controller.signal);
    this.pending = work;
    await work;
  }

  public cancel(): void {
    this.cancellationEpoch += 1;
    this.controller?.abort(new Error("A task or model change stopped prompt prefill."));
  }

  private async runSafely(
    generation: number,
    requests: readonly TextRequest[],
    signal: Readonly<AbortSignal>,
  ): Promise<void> {
    try {
      for (const request of requests) {
        signal.throwIfAborted();
        // eslint-disable-next-line no-await-in-loop
        await this.send(request, signal);
      }
      signal.throwIfAborted();
      this.completedGeneration = generation;
    } catch {
      // Prefix seeding is optional. A task must still run with an empty cache.
    } finally {
      this.pending = undefined;
      this.pendingGeneration = undefined;
      this.controller = undefined;
    }
  }
}

export { TextPrefill };
