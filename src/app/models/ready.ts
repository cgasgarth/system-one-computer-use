import type { ModelRole, ModelSelection } from "./catalog.ts";
import { modelName } from "./preferences.ts";
import { requestUnix } from "../../models/transport/unix.ts";
import { decisionResponseSchema } from "../../models/system-one-schema.ts";
import { textResponseSchema } from "../../models/text-schema.ts";

const READY_TOKENS = 32;
interface ReadyInput {
  readonly role: ModelRole;
  readonly selection: Readonly<ModelSelection>;
  readonly socketPath: string;
  readonly signal: Readonly<AbortSignal>;
  readonly timeoutMs: number;
}
async function verifySocketReady(input: ReadyInput): Promise<void> {
  input.signal.throwIfAborted();
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(input.timeoutMs)]);
  await (input.role === "decision"
    ? requestUnix({
        path: input.socketPath,
        message: {
          role: "decision",
          body: {
            model: modelName(input.selection),
            state: "Ready",
            questions: {
              next_action: {
                type: "choice",
                instructions: "Choose Ready.",
                criteria: { A0: "Ready", A1: "Not ready" },
              },
            },
          },
        },
        schema: decisionResponseSchema,
        signal,
      })
    : requestUnix({
        path: input.socketPath,
        message: {
          role: "text",
          body: {
            model: modelName(input.selection),
            temperature: 0,
            max_tokens: READY_TOKENS,
            messages: [{ role: "user", content: "Reply Ready." }],
          },
        },
        schema: textResponseSchema,
        signal,
      }));
}
export { verifySocketReady };
