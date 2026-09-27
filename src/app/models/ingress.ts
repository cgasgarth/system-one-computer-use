import { chmod } from "node:fs/promises";
import { once } from "node:events";
import { createServer } from "node:net";
import type { Socket } from "node:net";
import type { ReadonlyDeep } from "type-fest";
import {
  MAX_FRAME_BYTES,
  inferenceRequestSchema,
  inferenceResponseSchema,
} from "../../models/transport/protocol.ts";
import type { InferenceRequest, InferenceResponse } from "../../models/transport/protocol.ts";
import type { DecisionResponse } from "../../models/system-one-schema.ts";
import type { TextResponse } from "../../models/text-schema.ts";
import { clearStaleSocket } from "./sockets.ts";

const PRIVATE_SOCKET = 0o600;
const NEWLINE = 10;
interface ModelService {
  readonly sockets: { readonly ingress: string };
  readonly forward: (
    request: ReadonlyDeep<InferenceRequest>,
    signal: Readonly<AbortSignal>,
  ) => Promise<DecisionResponse | TextResponse>;
}
class ModelIngress {
  private readonly host: ReadonlyDeep<ModelService>;
  private readonly path: string;
  private readonly sockets = new Set<Readonly<Socket>>();
  private readonly server = createServer((socket) => {
    this.accept(socket);
  });
  public constructor(host: ReadonlyDeep<ModelService>) {
    this.host = host;
    this.path = host.sockets.ingress;
  }
  public async start(): Promise<void> {
    await clearStaleSocket(this.path);
    this.server.listen(this.path);
    await once(this.server, "listening");
    await chmod(this.path, PRIVATE_SOCKET);
  }
  // Socket methods mutate the owned connection as frames arrive and close.
  // eslint-disable-next-line typescript/prefer-readonly-parameter-types
  private accept(socket: Readonly<Socket>): void {
    this.sockets.add(socket);
    const cancellation = new AbortController();
    let frame = Buffer.alloc(0);
    let submitted = false;
    const respond = (response: ReadonlyDeep<InferenceResponse>): void => {
      if (socket.destroyed) {
        return;
      }
      const encoded = `${JSON.stringify(inferenceResponseSchema.parse(response))}\n`;
      socket.end(
        Buffer.byteLength(encoded) <= MAX_FRAME_BYTES
          ? encoded
          : `${JSON.stringify({ ok: false, error: "Model response exceeds the message size limit." })}\n`,
      );
    };
    socket.on("data", (chunk: Readonly<Buffer>) => {
      if (submitted) {
        return;
      }
      if (frame.length + chunk.length > MAX_FRAME_BYTES) {
        submitted = true;
        respond({ ok: false, error: "Model request exceeds the message size limit." });
        return;
      }
      frame = Buffer.concat([frame, Buffer.from(chunk)]);
      const end = frame.indexOf(NEWLINE);
      if (end === -1) {
        return;
      }
      submitted = true;
      try {
        if (
          frame
            .subarray(end + 1)
            .toString("utf8")
            .trim().length > 0
        ) {
          throw new Error("One model request is allowed per connection.");
        }
        const request = inferenceRequestSchema.parse(
          JSON.parse(frame.subarray(0, end).toString("utf8")),
        );
        const forward = async (): Promise<void> => {
          try {
            const body = await this.host.forward(request, cancellation.signal);
            respond({ ok: true, body });
          } catch (error) {
            respond({
              ok: false,
              error: error instanceof Error ? error.message : "Model inference failed.",
            });
          }
        };
        void forward();
      } catch (error) {
        respond({
          ok: false,
          error: error instanceof Error ? error.message : "Invalid model request.",
        });
      }
    });
    socket.once("error", () => {
      cancellation.abort(new Error("Model client disconnected."));
    });
    socket.once("close", () => {
      cancellation.abort(new Error("Model client disconnected."));
      this.sockets.delete(socket);
    });
  }
  public async close(): Promise<void> {
    for (const socket of this.sockets) {
      socket.destroy();
    }
    this.server.close();
    await once(this.server, "close");
    await clearStaleSocket(this.path);
  }
}

export { ModelIngress };
