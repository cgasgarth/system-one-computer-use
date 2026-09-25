import { describeAction } from "../agent/contracts.ts";
import type { Action, ActionChoices, Observation, Window } from "../agent/contracts.ts";
import { requestJson } from "./request.ts";
import { decisionResponseSchema } from "./system-one-schema.ts";
import type {
  ActionCriteria,
  ActionProbabilities,
  DecisionAnswer,
  DecisionRequest,
} from "./system-one-schema.ts";

const TIMEOUT_MS = 10_000;
const MAX_CONTROLS = 100;
const MAX_FIELD_CHARS = 100;
const MAX_STATE_CHARS = 6000;
const MIN_STATE_CHARS = 1200;
const PROBABILITY_TOLERANCE = 0.02;

interface Decision {
  readonly action: Action;
  readonly latencyMs: number;
  readonly probabilities: ActionProbabilities;
}

interface DecisionInput {
  readonly task: string;
  readonly observation: Observation;
  readonly actions: ActionChoices;
  readonly context?: string;
  readonly mode?: "browser" | "desktop" | undefined;
}
interface DecisionModel {
  readonly choose: (input: DecisionInput) => Promise<Decision>;
}

function describeControl(element: Window["elements"][number]): string {
  let value = "";
  if (element.value !== undefined && element.value !== null) {
    value = String(element.value);
  }
  return `${element.role} ${element.label ?? ""} ${value.slice(0, MAX_FIELD_CHARS)}`;
}

function describeObservation(observation: Observation, contextLength: number): string {
  const windows = observation.desktop.windows
    .map((window) => `${window.app_name}: ${window.title}`)
    .join(" | ");
  const lines = [`Windows: ${windows}`];
  const current = observation.window;
  if (current === undefined) {
    return [...lines, "No window selected."].join("\n");
  }
  const controls = current.elements
    .slice(0, MAX_CONTROLS)
    .map((element) => describeControl(element))
    .join(" | ");
  lines.push(
    `Current window: ${current.app_name}: ${current.window_title}`,
    `Visible controls and values: ${controls.slice(0, Math.max(MIN_STATE_CHARS, MAX_STATE_CHARS - contextLength))}`,
  );
  return lines.join("\n");
}

function decisionState(input: DecisionInput): string {
  const state = [`User request: ${input.task}`];
  if (input.context !== undefined && input.context.length > 0) {
    state.push(input.context);
  }
  if (input.mode === undefined) {
    state.push(
      "No tool set selected yet. Both Chrome and Mac desktop tools are available.",
      `Running applications: ${input.observation.desktop.apps.map((app) => app.name).join(", ")}.`,
    );
  } else {
    state.push(
      `Selected tool set: ${input.mode}. You can switch to the other tool set.`,
      describeObservation(input.observation, input.context?.length ?? 0),
    );
  }
  return state.join("\n");
}

function actionCriteria(actions: readonly Action[]): ActionCriteria {
  const criteria: ActionCriteria = {};
  for (const [index, action] of actions.entries()) {
    criteria[`A${index}`] = describeAction(action);
  }
  return criteria;
}

function validProbabilities(probabilities: ActionProbabilities, count: number): boolean {
  const keys = Object.keys(probabilities);
  const sum = Object.values(probabilities).reduce((total, value) => total + value, 0);
  if (keys.length !== count || Math.abs(sum - 1) > PROBABILITY_TOLERANCE) {
    return false;
  }
  return keys.every((_key, index) => `A${index}` in probabilities);
}

function decision(answer: DecisionAnswer, actions: readonly Action[], latencyMs: number): Decision {
  const action = actions.find((_candidate, index) => `A${index}` === answer.choice);
  if (action === undefined) {
    throw new Error(`System One selected unknown action ${JSON.stringify(answer.choice)}`);
  }
  if (!validProbabilities(answer.probabilities, actions.length)) {
    throw new Error("System One returned an invalid action probability distribution");
  }
  return { action, latencyMs, probabilities: answer.probabilities };
}

class SystemOneHttpDecisionModel implements DecisionModel {
  private readonly apiKey: string | undefined;
  private readonly endpoint: string;
  private readonly modelId: string;

  public constructor(endpoint: string, modelId: string, apiKey?: string) {
    this.endpoint = endpoint;
    this.modelId = modelId;
    this.apiKey = apiKey;
  }

  public async choose(input: DecisionInput): Promise<Decision> {
    const { actions } = input;
    const request: DecisionRequest = {
      model: this.modelId,
      questions: {
        next_action: {
          criteria: actionCriteria(actions),
          instructions: "Which tool call should the computer agent make next?",
          type: "choice",
        },
      },
      state: decisionState(input),
    };
    const start = performance.now();
    const payload = await requestJson({
      apiKey: this.apiKey,
      body: request,
      endpoint: this.endpoint,
      label: "System One",
      schema: decisionResponseSchema,
      timeoutMs: TIMEOUT_MS,
    });
    return decision(payload.answers.next_action, actions, performance.now() - start);
  }
}

export { SystemOneHttpDecisionModel };
export type { Decision, DecisionInput, DecisionModel };
