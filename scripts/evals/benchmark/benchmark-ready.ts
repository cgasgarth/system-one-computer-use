import { requestJson } from "../../../src/models/request.ts";
import { decisionResponseSchema } from "../../../src/models/system-one-schema.ts";
import { textResponseSchema } from "../../../src/models/text-schema.ts";
import { localModelEndpoint } from "../../../src/app/models/sockets.ts";

const PROBE_TIMEOUT_MS = 30_000;
const READY_TOKENS = 64;

async function probeDecision(socket: string, model: string): Promise<void> {
  await requestJson({
    endpoint: localModelEndpoint(socket, "decision"),
    apiKey: undefined,
    label: "Benchmark decision readiness",
    timeoutMs: PROBE_TIMEOUT_MS,
    schema: decisionResponseSchema,
    body: {
      model,
      state: "Readiness check. No computer action is requested.",
      questions: {
        next_action: {
          type: "choice",
          instructions: "Select Ready.",
          criteria: { A0: "Ready", A1: "Not ready" },
        },
      },
    },
  });
}
async function probeText(socket: string, model: string): Promise<void> {
  await requestJson({
    endpoint: localModelEndpoint(socket, "text"),
    apiKey: undefined,
    label: "Benchmark text readiness",
    timeoutMs: PROBE_TIMEOUT_MS,
    schema: textResponseSchema,
    body: {
      model,
      max_tokens: READY_TOKENS,
      temperature: 0,
      messages: [{ role: "user", content: "Reply with only: ready" }],
    },
  });
}

export { probeDecision, probeText };
