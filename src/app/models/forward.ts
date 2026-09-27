import type { ReadonlyDeep } from "type-fest";
import { requestJson } from "../../models/request.ts";
import { decisionResponseSchema } from "../../models/system-one-schema.ts";
import type { DecisionResponse } from "../../models/system-one-schema.ts";
import { textResponseSchema } from "../../models/text-schema.ts";
import type { TextResponse } from "../../models/text-schema.ts";
import type { InferenceRequest } from "../../models/transport/protocol.ts";
import { requestUnix } from "../../models/transport/unix.ts";
import type { ModelSlot } from "./slot.ts";

const REMOTE_TIMEOUT_MS = 60_000;
async function forwardRequest(
  slot: Readonly<ModelSlot>,
  request: ReadonlyDeep<InferenceRequest>,
  signal: Readonly<AbortSignal>,
): Promise<DecisionResponse | TextResponse> {
  if (request.role === "decision") {
    return slot.selection.source === "endpoint"
      ? requestJson({
          endpoint: slot.selection.url,
          apiKey: Bun.env["SYSTEM_ONE_API_KEY"],
          label: "Decision endpoint",
          body: request.body,
          schema: decisionResponseSchema,
          timeoutMs: REMOTE_TIMEOUT_MS,
          signal,
        })
      : requestUnix({
          path: slot.socketPath,
          message: request,
          schema: decisionResponseSchema,
          signal,
        });
  }
  return slot.selection.source === "endpoint"
    ? requestJson({
        endpoint: slot.selection.url,
        apiKey: Bun.env["TEXT_MODEL_API_KEY"],
        label: "Text endpoint",
        body: request.body,
        schema: textResponseSchema,
        timeoutMs: REMOTE_TIMEOUT_MS,
        signal,
      })
    : requestUnix({
        path: slot.socketPath,
        message: request,
        schema: textResponseSchema,
        signal,
      });
}
export { forwardRequest };
