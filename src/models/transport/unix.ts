import { createConnection } from "node:net";
import { z } from "zod";
import { MAX_FRAME_BYTES } from "./protocol.ts";

const NEWLINE_BYTE = 10;

interface UnixRequest<Body, Result> {
  readonly path: string;
  readonly message: Body;
  readonly schema: z.ZodType<Result>;
  readonly signal: Readonly<AbortSignal>;
}

function serializeFrame(message: Readonly<object>): string {
  const frame = `${JSON.stringify(message)}\n`;
  if (Buffer.byteLength(frame) > MAX_FRAME_BYTES) {
    throw new Error("Local model request exceeds the message size limit.");
  }
  return frame;
}

async function requestUnix<Body extends object, Result>(
  request: UnixRequest<Body, Result>,
): Promise<Result> {
  request.signal.throwIfAborted();
  const frame = serializeFrame(request.message);
  const { promise, resolve, reject } = Promise.withResolvers<Result>();
  const listeners = new AbortController();
  {
    const socket = createConnection({ path: request.path });
    let received = Buffer.alloc(0);
    let settled = false;
    const stop = (): void => {
      listeners.abort();
      socket.destroy();
    };
    const fail = (error: Readonly<Error>): void => {
      if (!settled) {
        settled = true;
        stop();
        reject(error);
      }
    };
    const abort = (): void => {
      fail(
        request.signal.reason instanceof Error
          ? request.signal.reason
          : new Error("Local model request cancelled."),
      );
    };
    request.signal.addEventListener("abort", abort, { once: true, signal: listeners.signal });
    socket.once("connect", () => {
      socket.write(frame);
    });
    socket.on("error", fail);
    socket.once("close", () => {
      fail(new Error("Local model closed the connection before returning a result."));
    });
    socket.on("data", (chunk: Readonly<Buffer>) => {
      if (settled) {
        return;
      }
      if (received.length + chunk.length > MAX_FRAME_BYTES) {
        fail(new Error("Local model response exceeds the message size limit."));
        return;
      }
      received = Buffer.concat([received, chunk]);
      const end = received.indexOf(NEWLINE_BYTE);
      if (end === -1) {
        return;
      }
      try {
        const envelope = z
          .discriminatedUnion("ok", [
            z.strictObject({ ok: z.literal(true), body: request.schema }),
            z.strictObject({ ok: z.literal(false), error: z.string() }),
          ])
          .parse(JSON.parse(received.subarray(0, end).toString("utf8")));
        if (!envelope.ok) {
          fail(new Error(envelope.error));
          return;
        }
        settled = true;
        stop();
        resolve(envelope.body);
      } catch (error) {
        fail(error instanceof Error ? error : new Error("Local model returned invalid data."));
      }
    });
    if (request.signal.aborted) {
      abort();
    }
  }
  return promise;
}

export { requestUnix };
