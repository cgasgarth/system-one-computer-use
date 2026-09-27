import type { Config } from "../../src/app/config.ts";
import { requestJson } from "../../src/models/request.ts";
import { decisionResponseSchema } from "../../src/models/system-one-schema.ts";
import { textResponseSchema } from "../../src/models/text-schema.ts";

const STARTUP_TIMEOUT_MS = 120_000;
const READY_TOKENS = 64;

// The menu app prepares both models before starting its task timer. CLI
// Evaluations must do the same when the managed host has unloaded idle weights.
async function prepareModels(config: Config): Promise<void> {
  await requestJson({
    endpoint: config.SYSTEM_ONE_URL,
    apiKey: config.SYSTEM_ONE_API_KEY,
    label: "Decision model preparation",
    timeoutMs: STARTUP_TIMEOUT_MS,
    schema: decisionResponseSchema,
    body: {
      model: config.SYSTEM_ONE_MODEL,
      state: "Runtime readiness check. No computer actions are requested.",
      questions: {
        next_action: {
          type: "choice",
          instructions: "Select Ready.",
          criteria: { A0: "Ready", A1: "Not ready" },
        },
      },
    },
  });
  await requestJson({
    endpoint: config.TEXT_MODEL_URL,
    apiKey: config.TEXT_MODEL_API_KEY,
    label: "Text model preparation",
    timeoutMs: STARTUP_TIMEOUT_MS,
    schema: textResponseSchema,
    body: {
      model: config.TEXT_MODEL_ID,
      messages: [{ role: "user", content: "Reply with only: ready" }],
      max_tokens: READY_TOKENS,
      temperature: 0,
    },
  });
}
export { prepareModels };
