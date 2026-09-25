import { describeAction } from "../agent/contracts.ts";
import type { Action, ActionChoices, Observation, Window } from "../agent/contracts.ts";
import { requestJson } from "./request.ts";
import { completionAnswerSchema, decisionResponseSchema } from "./system-one-schema.ts";
import type {
  ActionCriteria,
  ActionProbabilities,
  CompletionAnswer,
  DecisionAnswer,
  DecisionRequest,
  DecisionResponse,
} from "./system-one-schema.ts";

const TIMEOUT_MS = 10_000;
const MAX_CONTROLS = 100;
const MAX_FIELD_CHARS = 100;
const MAX_STATE_CHARS = 6000;
const MIN_STATE_CHARS = 1200;
const PROBABILITY_TOLERANCE = 0.02;
const COMPLETION_CLASSES = 2;
const COMPLETION_THRESHOLD = 0.6;

interface Decision {
  readonly action: Action;
  readonly latencyMs: number;
  readonly probabilities: ActionProbabilities;
  readonly completion?: CompletionAnswer;
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
  const flags = [
    element.enabled === false ? "disabled" : "",
    element.selected === true ? "selected" : "",
    element.focused === true ? "focused" : "",
  ]
    .filter(Boolean)
    .join(", ");
  return `${element.role} ${element.label?.slice(0, MAX_FIELD_CHARS) ?? ""} ${value.slice(0, MAX_FIELD_CHARS)}${flags.length === 0 ? "" : ` (${flags})`}`;
}

function describeObservation(observation: Observation, contextLength: number): string {
  const windows = observation.desktop.windows
    .map((window) => `${window.app_name}: ${window.title}`)
    .join(" | ");
  const current = observation.window;
  if (current === undefined) {
    if (observation.application !== undefined) {
      return `Selected application: ${observation.application.name}. It is running without a controllable window.\nOther windows: ${windows}`;
    }
    return `Windows: ${windows}\nNo window selected.`;
  }
  const controls = current.elements
    .slice(0, MAX_CONTROLS)
    .map((element) => describeControl(element))
    .join(" | ");
  const lines = [
    `Windows: ${windows}`,
    `Current window: ${current.app_name}: ${current.window_title}`,
    `Visible controls and values: ${controls.slice(0, Math.max(MIN_STATE_CHARS, MAX_STATE_CHARS - contextLength))}`,
  ];
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

function criteriaFor(descriptions: readonly string[]): ActionCriteria {
  const criteria: ActionCriteria = {};
  for (const [index, description] of descriptions.entries()) {
    criteria[`A${index}`] = description;
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
    const checkCompletion =
      input.observation.window !== undefined || input.observation.application !== undefined;
    const start = performance.now();
    const completion = checkCompletion ? await this.checkCompletion(input) : undefined;
    if (
      completion?.choice === "A0" &&
      (completion.probabilities["A0"] ?? 0) >= COMPLETION_THRESHOLD
    ) {
      const action = input.actions.find((candidate) => candidate.kind === "finish");
      if (action === undefined) {
        throw new Error("The completion decision has no Finish option");
      }
      return {
        action,
        completion,
        probabilities: completion.probabilities,
        latencyMs: performance.now() - start,
      };
    }
    const actions = checkCompletion
      ? input.actions.filter((action) => action.kind !== "finish")
      : input.actions;
    const payload = await this.request({
      model: this.modelId,
      state: decisionState(input),
      questions: {
        next_action: {
          type: "choice",
          instructions: "Which tool call should the computer agent make next?",
          criteria: criteriaFor(actions.map((action) => describeAction(action))),
        },
      },
    });
    return {
      ...decision(payload.answers.next_action, actions, performance.now() - start),
      ...(completion === undefined ? {} : { completion }),
    };
  }

  private async checkCompletion(input: DecisionInput): Promise<CompletionAnswer> {
    const { window } = input.observation;
    const values =
      window?.elements
        .filter(
          (element) =>
            (element.value !== undefined && element.value !== null && element.value !== "") ||
            element.selected === true,
        )
        .map((element) => describeControl(element))
        .join(" | ") ?? "";
    const state = [
      `User request: ${input.task}`,
      `Observed result: ${window?.app_name ?? input.observation.application?.name} is the selected application.`,
      window === undefined
        ? "No controllable window is available."
        : `Window title: ${window.window_title}.`,
      ...(window?.url === undefined ? [] : [`Current URL: ${window.url}`]),
      `Control values: ${values.slice(0, MAX_STATE_CHARS)}`,
    ].join("\n");
    const response = await this.request({
      model: this.modelId,
      state,
      questions: {
        next_action: {
          type: "choice",
          instructions: "Has the user request been completed?",
          criteria: {
            A0: "true: The request is complete.",
            A1: "false: The request is not complete.",
          },
        },
      },
    });
    const answer = completionAnswerSchema.parse(response.answers.next_action);
    if (!validProbabilities(answer.probabilities, COMPLETION_CLASSES)) {
      throw new Error("System One returned an invalid completion decision");
    }
    return answer;
  }

  private async request(body: DecisionRequest): Promise<DecisionResponse> {
    return requestJson({
      apiKey: this.apiKey,
      body,
      endpoint: this.endpoint,
      label: "System One",
      schema: decisionResponseSchema,
      timeoutMs: TIMEOUT_MS,
    });
  }
}

export { SystemOneHttpDecisionModel };
export type { Decision, DecisionInput, DecisionModel };
