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
const PROBABILITY_TOLERANCE = 0.02;

interface Decision {
  readonly action: Action;
  readonly latencyMs: number;
  readonly probabilities: ActionProbabilities;
}

interface DecisionModel {
  readonly choose: (
    task: string,
    observation: Observation,
    actions: ActionChoices,
  ) => Promise<Decision>;
}

function describeControl(element: Window["elements"][number]): string {
  let value = "";
  if (element.value !== undefined && element.value !== null) {
    value = String(element.value);
  }
  return `${element.role} ${element.label ?? ""} ${value.slice(0, MAX_FIELD_CHARS)}`;
}

function describeObservation(observation: Observation): string {
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
    `Visible controls and values: ${controls.slice(0, MAX_STATE_CHARS)}`,
  );
  return lines.join("\n");
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

  public async choose(
    task: string,
    observation: Observation,
    actions: ActionChoices,
  ): Promise<Decision> {
    const request: DecisionRequest = {
      model: this.modelId,
      questions: {
        next_action: {
          criteria: actionCriteria(actions),
          instructions: `Choose one next computer action. Choose finish only when the observed state proves completion.\nTask: ${task}`,
          type: "choice",
        },
      },
      state: describeObservation(observation),
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
export type { Decision, DecisionModel };
