import { requestJson } from "./request.ts";
import { decisionResponseSchema } from "./system-one-schema.ts";
import type { DecisionRequest, DecisionResponse } from "./system-one-schema.ts";

const TIMEOUT_MS = 10_000;
type DecisionRequestPhase =
  | "completion"
  | "completion-target"
  | "completion-commit"
  | "operation"
  | "target-page"
  | "target"
  | "action-verification"
  | "commit-classification"
  | "commit-authorization"
  | "field-readiness";
interface DecisionRequestEvent {
  readonly phase: DecisionRequestPhase;
  readonly status: "start" | "ok" | "error";
  readonly candidateCount: number;
  readonly elapsedMs?: number;
  readonly choice?: string;
  readonly selectedProbability?: number;
}
interface DecisionRequestContext {
  readonly signal?: Readonly<AbortSignal>;
  readonly onRequest?: (event: DecisionRequestEvent) => void;
}
interface DecisionCall {
  readonly context: DecisionRequestContext;
  readonly phase: DecisionRequestPhase;
  readonly body: DecisionRequest;
  readonly endpoint: string;
  readonly apiKey: string | undefined;
}

async function requestDecision(call: Readonly<DecisionCall>): Promise<DecisionResponse> {
  call.context.signal?.throwIfAborted();
  const candidateCount = Object.keys(call.body.questions.next_action.criteria).length;
  const started = performance.now();
  const notify = (status: DecisionRequestEvent["status"], result?: DecisionResponse): void => {
    try {
      const answer = result?.answers.next_action;
      call.context.onRequest?.({
        phase: call.phase,
        status,
        candidateCount,
        elapsedMs: performance.now() - started,
        ...(answer === undefined
          ? {}
          : {
              choice: answer.choice,
              selectedProbability: answer.probabilities[answer.choice],
            }),
      });
    } catch {
      // Observability must not change a model decision.
    }
  };
  notify("start");
  try {
    const result = await requestJson({
      apiKey: call.apiKey,
      body: call.body,
      endpoint: call.endpoint,
      label: "System One",
      schema: decisionResponseSchema,
      timeoutMs: TIMEOUT_MS,
      ...(call.context.signal === undefined ? {} : { signal: call.context.signal }),
    });
    notify("ok", result);
    return result;
  } catch (error) {
    notify("error");
    throw error;
  }
}

export { requestDecision };
export type { DecisionRequestContext, DecisionRequestEvent, DecisionRequestPhase };
