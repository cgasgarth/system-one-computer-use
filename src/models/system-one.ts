import type { Action, ActionChoices, Observation } from "../agent/contracts.ts";
import {
  actionDescription,
  actionGroups,
  criteriaFor,
  decisionState,
  operationState,
  operationTargetInput,
} from "./decision-context.ts";
import type { OperationDecision } from "./decision-context.ts";
import { requestDecision } from "./decision-request.ts";
import type { DecisionRequestContext, DecisionRequestPhase } from "./decision-request.ts";
import { ActionSelectionError } from "./action-selection-error.ts";
import type {
  ActionProbabilities,
  DecisionAnswer,
  DecisionRequest,
  DecisionResponse,
} from "./system-one-schema.ts";

const PROBABILITY_TOLERANCE = 0.02;
const MIN_MODEL_CHOICES = 2;
const MAX_OPERATION_PASSES = 2;
const MAX_TARGETS_PER_PAGE = 255;
const MAX_TARGET_ROW_BYTES = 7600;
const TARGET_FEEDBACK_RESERVE_BYTES = 256;
const NEXT_PAGE_DESCRIPTION =
  "None of these targets; inspect the next target page without taking an action.";
const RETURN_TO_OPERATIONS_DESCRIPTION =
  "None of these targets; choose another operation without taking an action.";
const NO_TARGET_DESCRIPTION = "None of these targets; no observed target here is suitable.";
const MIN_CHOICES_WITH_NEXT_AND_RETURN = 3;
const MAX_REQUESTS_PER_DECISION = 20;
const MAX_DECISION_MS = 60_000;
interface Decision {
  readonly action: Action;
  readonly latencyMs: number;
  readonly probabilities: ActionProbabilities;
  readonly operation?: OperationDecision;
  readonly rejectedOperations?: readonly OperationDecision[];
  readonly candidates?: readonly Action[];
}

interface DecisionInput extends DecisionRequestContext {
  readonly task: string;
  readonly observation: Observation;
  readonly actions: ActionChoices;
  readonly context?: string;
  readonly feedback?: string;
  readonly mode?: "browser" | "desktop" | undefined;
}
interface DecisionModel {
  readonly choose: (input: DecisionInput) => Promise<Decision>;
}
interface DecisionModelOptions {
  readonly apiKey?: string | undefined;
  readonly maxChoices?: number;
}
interface TargetChoiceOptions {
  readonly otherOperations: boolean;
  readonly hasMorePages?: boolean;
  readonly hasPriorPages?: boolean;
  readonly separateReturn?: boolean;
}
type TargetOutcome = "selected" | "next_page" | "reject_operation";
function targetExtraDescriptions(options: TargetChoiceOptions): readonly string[] {
  if (options.hasMorePages === true) {
    return options.separateReturn === true
      ? [NEXT_PAGE_DESCRIPTION, RETURN_TO_OPERATIONS_DESCRIPTION]
      : [NEXT_PAGE_DESCRIPTION];
  }
  if (options.otherOperations) {
    return [RETURN_TO_OPERATIONS_DESCRIPTION];
  }
  return options.hasPriorPages === true ? [NO_TARGET_DESCRIPTION] : [];
}
function targetOutcome(choice: string, count: number, options: TargetChoiceOptions): TargetOutcome {
  if (options.hasMorePages === true && choice === `A${count}`) {
    return "next_page";
  }
  if (
    options.hasMorePages === true &&
    options.separateReturn === true &&
    choice === `A${count + 1}`
  ) {
    return "reject_operation";
  }
  return targetExtraDescriptions(options).length > 0 && choice === `A${count}`
    ? "reject_operation"
    : "selected";
}
function validProbabilities(probabilities: ActionProbabilities, count: number): boolean {
  const keys = Object.keys(probabilities);
  const sum = Object.values(probabilities).reduce((total, value) => total + value, 0);
  if (keys.length !== count || Math.abs(sum - 1) > PROBABILITY_TOLERANCE) {
    return false;
  }
  return keys.every((_key, index) => `A${index}` in probabilities);
}
function decision(
  answer: DecisionAnswer,
  actions: readonly Action[],
  timing: { readonly latencyMs: number; readonly optionCount: number },
): Decision {
  const action = actions.find((_candidate, index) => `A${index}` === answer.choice);
  if (action === undefined) {
    throw new Error(`System One selected unknown action ${JSON.stringify(answer.choice)}`);
  }
  if (!validProbabilities(answer.probabilities, timing.optionCount)) {
    throw new Error("System One returned an invalid action probability distribution");
  }
  return { action, latencyMs: timing.latencyMs, probabilities: answer.probabilities };
}

class SystemOneDecisionModel implements DecisionModel {
  private readonly apiKey: string | undefined;
  private readonly endpoint: string;
  private readonly modelId: string;
  private readonly maxChoices: number;

  public constructor(endpoint: string, modelId: string, options: DecisionModelOptions = {}) {
    const maxChoices = options.maxChoices ?? MAX_TARGETS_PER_PAGE;
    if (
      !Number.isInteger(maxChoices) ||
      maxChoices < MIN_MODEL_CHOICES ||
      maxChoices > MAX_TARGETS_PER_PAGE
    ) {
      throw new Error("The decision model choice limit must be an integer from 2 to 255.");
    }
    this.endpoint = endpoint;
    this.modelId = modelId;
    this.apiKey = options.apiKey;
    this.maxChoices = maxChoices;
  }

  // Choose an operation and target from the current observation.
  public async choose(initial: DecisionInput): Promise<Decision> {
    initial.signal?.throwIfAborted();
    const deadline = AbortSignal.timeout(MAX_DECISION_MS);
    const signal =
      initial.signal === undefined ? deadline : AbortSignal.any([initial.signal, deadline]);
    let requests = 0;
    let pageAdvances = 0;
    const input: DecisionInput = {
      ...initial,
      signal,
      beforeRequest: () => {
        signal.throwIfAborted();
        if (requests >= MAX_REQUESTS_PER_DECISION + pageAdvances) {
          throw new Error(
            `Decision stalled on this observation after ${requests} model requests. Stopped before the next action. Refresh the screen or narrow the request.`,
          );
        }
        requests += 1;
      },
    };
    try {
      return await this.chooseObserved(input, () => {
        pageAdvances += 1;
      });
    } catch (error) {
      if (deadline.aborted && initial.signal?.aborted !== true) {
        throw new Error(
          `Decision stalled on this observation after ${requests} model requests and ${MAX_DECISION_MS} ms. Stopped before the next action. Refresh the screen or narrow the request.`,
          { cause: error },
        );
      }
      throw error;
    }
  }

  private async chooseObserved(input: DecisionInput, onPageAdvance: () => void): Promise<Decision> {
    return this.chooseAvailable(input, performance.now(), onPageAdvance);
  }

  // The bounded retry keeps operation and target evidence together.
  private async chooseAvailable(
    input: DecisionInput,
    started: number,
    onPageAdvance: () => void,
  ): Promise<Decision> {
    let remaining: readonly Action[] = input.actions;
    let currentInput = input;
    const rejectedOperations: OperationDecision[] = [];
    let groupCount = 0;
    while (remaining.length > 0 && groupCount < MAX_OPERATION_PASSES) {
      groupCount += 1;
      // Retry with another operation group, never mix targets from different operations.
      // eslint-disable-next-line no-await-in-loop
      const { actions, operation } = await this.operationActions(currentInput, remaining);
      const otherOperations = operation !== undefined && remaining.length > actions.length;
      // None traverses target pages inside this operation; it does not spend an operation pass.
      // eslint-disable-next-line no-await-in-loop
      const attempt = await this.choosePages(
        operationTargetInput(currentInput, operation),
        actions,
        {
          otherOperations,
          started,
          onPageAdvance,
        },
      );
      if (attempt.decision !== undefined) {
        return {
          ...attempt.decision,
          ...(attempt.candidates === undefined ? {} : { candidates: attempt.candidates }),
          rejectedOperations,
          ...(operation === undefined ? {} : { operation }),
        };
      }
      if (operation !== undefined) {
        rejectedOperations.push(operation);
      }
      remaining = remaining.filter((action) => !actions.includes(action));
      currentInput = {
        ...input,
        feedback: [
          input.feedback ?? "",
          "The model selected no target in the previous operation on this observation. Choose another available operation.",
        ]
          .filter(Boolean)
          .join("\n"),
      };
    }
    throw new ActionSelectionError(rejectedOperations, groupCount);
  }

  private targetPages(
    input: DecisionInput,
    actions: readonly Action[],
    otherOperations: boolean,
  ): { readonly pages: readonly (readonly Action[])[]; readonly separateReturn: boolean } {
    if (actions.length === 1) {
      return { pages: [actions], separateReturn: false };
    }
    const pages = this.packTargetPages(input, actions, [NEXT_PAGE_DESCRIPTION]);
    if (
      pages.length <= 1 ||
      !otherOperations ||
      this.maxChoices < MIN_CHOICES_WITH_NEXT_AND_RETURN
    ) {
      return { pages, separateReturn: false };
    }
    return {
      pages: this.packTargetPages(input, actions, [
        NEXT_PAGE_DESCRIPTION,
        RETURN_TO_OPERATIONS_DESCRIPTION,
      ]),
      separateReturn: true,
    };
  }

  private packTargetPages(
    input: DecisionInput,
    actions: readonly Action[],
    extraDescriptions: readonly string[],
  ): readonly (readonly Action[])[] {
    const state = decisionState(input);
    const described = actions.map((action) => ({
      action,
      description: actionDescription(action, input.observation),
    }));
    const pages: Action[][] = [];
    let page: Action[] = [];
    let pageDescriptions: string[] = [];
    for (const { action, description } of described) {
      const candidate = [...page, action];
      if (
        this.targetRowBytes(state, input.task, [description, ...extraDescriptions]) >
        MAX_TARGET_ROW_BYTES - TARGET_FEEDBACK_RESERVE_BYTES
      ) {
        throw new Error(
          "capacity_choices: One observed target exceeds the request budget; no target was truncated.",
        );
      }
      if (
        candidate.length + extraDescriptions.length > this.maxChoices ||
        this.targetRowBytes(state, input.task, [
          ...pageDescriptions,
          description,
          ...extraDescriptions,
        ]) >
          MAX_TARGET_ROW_BYTES - TARGET_FEEDBACK_RESERVE_BYTES
      ) {
        pages.push(page);
        page = [];
        pageDescriptions = [];
      }
      page.push(action);
      pageDescriptions.push(description);
    }
    if (page.length > 0) {
      pages.push(page);
    }
    return pages;
  }

  private async choosePages(
    input: DecisionInput,
    actions: readonly Action[],
    options: {
      readonly otherOperations: boolean;
      readonly started: number;
      readonly onPageAdvance: () => void;
    },
  ): Promise<{
    readonly decision?: Decision;
    readonly candidates?: readonly Action[];
  }> {
    const { pages, separateReturn } = this.targetPages(input, actions, options.otherOperations);
    for (const [index, page] of pages.entries()) {
      const hasMorePages = index < pages.length - 1;
      // eslint-disable-next-line no-await-in-loop
      const target = await this.targetChoice(input, page, {
        otherOperations: options.otherOperations,
        hasMorePages,
        hasPriorPages: index > 0,
        separateReturn,
      });
      if (target.outcome === "reject_operation") {
        return {};
      }
      if (target.outcome === "selected") {
        return {
          decision: decision(target.answer, page, {
            latencyMs: performance.now() - options.started,
            optionCount: target.optionCount,
          }),
          candidates: page,
        };
      }
      if (hasMorePages) {
        options.onPageAdvance();
      }
    }
    return {};
  }

  private async targetChoice(
    input: DecisionInput,
    actions: readonly Action[],
    options: TargetChoiceOptions,
  ): Promise<{
    readonly answer: DecisionAnswer;
    readonly optionCount: number;
    readonly outcome: TargetOutcome;
  }> {
    if (actions.length === 1 && options.hasMorePages !== true && options.hasPriorPages !== true) {
      // The operation choice already selected this sole target; do not ask it to veto itself.
      return {
        answer: { choice: "A0", probabilities: { A0: 1 } },
        optionCount: 1,
        outcome: "selected",
      };
    }
    const descriptions = actions.map((action) => actionDescription(action, input.observation));
    descriptions.push(...targetExtraDescriptions(options));
    const body = this.targetRequest(decisionState(input), input.task, descriptions);
    if (Buffer.byteLength(JSON.stringify(body)) > MAX_TARGET_ROW_BYTES) {
      throw new Error("capacity_choices: Target request exceeds the lossless request budget.");
    }
    const payload = await this.request(input, "target", body);
    const answer = payload.answers.next_action;
    if (!validProbabilities(answer.probabilities, descriptions.length)) {
      throw new Error("System One returned an invalid target distribution");
    }
    return {
      answer,
      optionCount: descriptions.length,
      outcome: targetOutcome(answer.choice, actions.length, options),
    };
  }

  private targetRequest(
    state: string,
    task: string,
    descriptions: readonly string[],
  ): DecisionRequest {
    return {
      model: this.modelId,
      state,
      questions: {
        next_action: {
          type: "choice",
          instructions: `Which action best advances this goal: ${task}`,
          criteria: criteriaFor(descriptions),
        },
      },
    };
  }

  private targetRowBytes(state: string, task: string, descriptions: readonly string[]): number {
    return Buffer.byteLength(JSON.stringify(this.targetRequest(state, task, descriptions)));
  }

  private async operationActions(
    input: DecisionInput,
    actions: readonly Action[],
  ): Promise<{ readonly actions: readonly Action[]; readonly operation?: OperationDecision }> {
    const groups = actionGroups(actions);
    const hasTargetedOperation =
      (input.observation.window !== undefined &&
        actions.some((action) =>
          ["click_element", "compose_text", "invoke_menu", "inspect_menu"].includes(action.kind),
        )) ||
      actions.filter((action) => action.kind === "request_app").length > 1;
    if (groups.length <= 1 || !hasTargetedOperation) {
      return { actions };
    }
    const descriptions = groups.map((group) => {
      const description =
        group.kind === "blocked"
          ? "Stop only when required input or access is missing and no observed action can advance the request."
          : group.description;
      const showTargets = group.kind === "observe_window" || group.kind === "select_surface";
      return showTargets
        ? `${description} Available targets: ${group.actions.map((action) => actionDescription(action, input.observation)).join(" | ")}`
        : description;
    });
    if (descriptions.length > this.maxChoices) {
      throw new Error(
        `capacity_choices: This decision model supports at most ${this.maxChoices} operation choices; ${descriptions.length} are available. Choose another model for this screen.`,
      );
    }
    const response = await this.request(input, "operation", {
      model: this.modelId,
      state: operationState(input, actions),
      questions: {
        next_action: {
          type: "choice",
          instructions: `Which operation and available target best advance the current request: ${input.task}? Use the recent action results; do not repeat ineffective window switching.`,
          criteria: criteriaFor(descriptions),
        },
      },
    });
    const answer = response.answers.next_action;
    if (!validProbabilities(answer.probabilities, groups.length)) {
      throw new Error("System One returned an invalid operation distribution");
    }
    const group = groups.find((_entry, index) => `A${index}` === answer.choice);
    if (group === undefined) {
      throw new Error("System One selected an unavailable operation");
    }
    return {
      actions: group.actions,
      operation: { options: descriptions, answer },
    };
  }

  private async request(
    input: DecisionInput,
    phase: DecisionRequestPhase,
    body: DecisionRequest,
  ): Promise<DecisionResponse> {
    const count = Object.keys(body.questions.next_action.criteria).length;
    if (count > this.maxChoices) {
      throw new Error(
        `capacity_choices: This decision model supports at most ${this.maxChoices} choices; ${count} were offered.`,
      );
    }
    return requestDecision({
      context: input,
      phase,
      body,
      endpoint: this.endpoint,
      apiKey: this.apiKey,
    });
  }
}

export { SystemOneDecisionModel };
export type { Decision, DecisionInput, DecisionModel };
export type { DecisionRequestEvent } from "./decision-request.ts";
