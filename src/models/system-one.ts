import type { Action, ActionChoices, Observation } from "../agent/contracts.ts";
import { actionDescription, actionGroups, criteriaFor, decisionState } from "./decision-context.ts";
import type { OperationDecision } from "./decision-context.ts";
import type { ClickInspection } from "../computer/types.ts";
import { requestDecision } from "./decision-request.ts";
import type { DecisionRequestContext, DecisionRequestPhase } from "./decision-request.ts";
import { ActionSelectionError } from "./action-selection-error.ts";
import type { RejectedAction } from "./action-selection-error.ts";
import { verifyCommit } from "./commit-verification.ts";
import type { ActionCheck } from "./action-check.ts";
import { binaryAnswerSchema } from "./system-one-schema.ts";
import type {
  ActionProbabilities,
  BinaryAnswer,
  DecisionAnswer,
  DecisionRequest,
  DecisionResponse,
} from "./system-one-schema.ts";

const PROBABILITY_TOLERANCE = 0.02;
const COMPLETION_CLASSES = 2;
const MAX_OPERATION_PASSES = 2;
const MAX_TARGETS_PER_PAGE = 255;
const MAX_REQUESTS_PER_DECISION = 20;
const MAX_DECISION_MS = 60_000;
interface Decision {
  readonly action: Action;
  readonly latencyMs: number;
  readonly probabilities: ActionProbabilities;
  readonly checks?: readonly ActionCheck[];
  readonly operation?: OperationDecision;
  readonly rejectedOperations?: readonly OperationDecision[];
  readonly rejectedActions?: readonly RejectedAction[];
  readonly candidates?: readonly Action[];
}

interface DecisionInput extends DecisionRequestContext {
  readonly task: string;
  readonly observation: Observation;
  readonly actions: ActionChoices;
  readonly context?: string;
  readonly feedback?: string;
  readonly recentActions?: readonly {
    readonly action: Action;
    readonly result: "returned" | "error" | "unchanged";
  }[];
  readonly inspectClick?: (
    action: Extract<Action, { kind: "click_element" }>,
  ) => Promise<ClickInspection>;
  readonly mode?: "browser" | "desktop" | undefined;
}
interface DecisionModel {
  readonly choose: (input: DecisionInput) => Promise<Decision>;
}
interface DecisionModelOptions {
  readonly apiKey?: string | undefined;
  readonly maxChoices?: number;
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
function rejectedActionFeedback(
  action: Action,
  checks: readonly ActionCheck[],
  observation: Observation,
): string {
  const reasons = checks.flatMap((check) => {
    if (check.phase === "commit-authorization" && check.answer.choice === "A1") {
      return ["authorization for its stored effect was not established"];
    }
    if (check.phase === "field-readiness" && check.answer.choice === "A0") {
      return ["a requested field change was judged still missing"];
    }
    return [];
  });
  const reason =
    reasons.length === 0 ? "it did not pass its current action check" : reasons.join("; ");
  return `The proposed action ${actionDescription(action, observation)} was not executed because ${reason}. Choose another observed action.`;
}
function declinedSoleTarget(
  remaining: readonly Action[],
  checks: readonly ActionCheck[],
  rejected: readonly RejectedAction[],
): ActionSelectionError {
  const [sole] = remaining;
  return new ActionSelectionError(checks, [], {
    groupCount: 1,
    rejectedActions:
      sole === undefined
        ? rejected
        : [...rejected, { action: sole, reason: "The model selected None for this target." }],
  });
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
      maxChoices < COMPLETION_CLASSES ||
      maxChoices > MAX_TARGETS_PER_PAGE
    ) {
      throw new Error("The decision model choice limit must be an integer from 2 to 255.");
    }
    this.endpoint = endpoint;
    this.modelId = modelId;
    this.apiKey = options.apiKey;
    this.maxChoices = maxChoices;
  }

  // One current observation grounds completion, target identity, and persistence.
  public async choose(initial: DecisionInput): Promise<Decision> {
    initial.signal?.throwIfAborted();
    const deadline = AbortSignal.timeout(MAX_DECISION_MS);
    const signal =
      initial.signal === undefined ? deadline : AbortSignal.any([initial.signal, deadline]);
    let requests = 0;
    const input: DecisionInput = {
      ...initial,
      signal,
      beforeRequest: () => {
        signal.throwIfAborted();
        if (requests >= MAX_REQUESTS_PER_DECISION) {
          throw new Error(
            `Decision stalled on this observation after ${requests} model requests. Stopped before the next action. Refresh the screen or narrow the request.`,
          );
        }
        requests += 1;
      },
    };
    try {
      return await this.chooseObserved(input);
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

  private async chooseObserved(input: DecisionInput): Promise<Decision> {
    if (input.actions.length <= this.maxChoices) {
      return this.chooseDirect(input, performance.now());
    }
    return this.chooseAvailable(input, input.actions, performance.now());
  }

  private async chooseDirect(input: DecisionInput, started: number): Promise<Decision> {
    let remaining: readonly Action[] = input.actions;
    let feedback = input.feedback ?? "";
    const rejectedChecks: ActionCheck[] = [];
    const rejectedActions: RejectedAction[] = [];
    while (remaining.length > 0) {
      const currentInput = { ...input, feedback };
      // Each retry removes only the rejected action; other operations remain available.
      // eslint-disable-next-line no-await-in-loop
      const { answer, optionCount } = await this.directAnswer(currentInput, remaining);
      if (answer.choice === `A${remaining.length}`) {
        throw declinedSoleTarget(remaining, rejectedChecks, rejectedActions);
      }
      const selected = decision(answer, remaining, {
        latencyMs: performance.now() - started,
        optionCount,
      });
      // eslint-disable-next-line no-await-in-loop
      const attempt = await this.verifySelected(currentInput, selected, started);
      if (attempt.decision !== undefined) {
        return {
          ...attempt.decision,
          checks: [...rejectedChecks, ...attempt.checks],
          rejectedActions,
          candidates: remaining,
        };
      }
      rejectedChecks.push(...attempt.checks);
      const rejected = rejectedActionFeedback(selected.action, attempt.checks, input.observation);
      rejectedActions.push({ action: selected.action, reason: rejected });
      feedback = [input.feedback ?? "", rejected].filter(Boolean).join("\n");
      remaining = remaining.filter((action) => action !== selected.action);
    }
    throw new ActionSelectionError(rejectedChecks, [], { groupCount: 1, rejectedActions });
  }

  private async directAnswer(
    input: DecisionInput,
    actions: readonly Action[],
  ): Promise<{ readonly answer: DecisionAnswer; readonly optionCount: number }> {
    const descriptions = actions.map((action) => actionDescription(action, input.observation));
    if (actions.length === 1) {
      descriptions.push("None of these actions; do not execute the sole remaining target.");
    }
    const response = await this.request(input, "target", {
      model: this.modelId,
      state: decisionState(input),
      questions: {
        next_action: {
          type: "choice",
          instructions: `Which action best advances this goal: ${input.task}`,
          criteria: criteriaFor(descriptions),
        },
      },
    });
    const answer = response.answers.next_action;
    if (!validProbabilities(answer.probabilities, descriptions.length)) {
      throw new Error("System One returned an invalid direct-action distribution");
    }
    return { answer, optionCount: descriptions.length };
  }

  // The bounded retry keeps operation and target evidence together.
  // eslint-disable-next-line eslint/max-statements
  private async chooseAvailable(
    input: DecisionInput,
    available: readonly Action[],
    started: number,
  ): Promise<Decision> {
    let remaining = available;
    let currentInput = input;
    const rejectedOperations: OperationDecision[] = [];
    const rejectedChecks: ActionCheck[] = [];
    let groupCount = 0;
    while (remaining.length > 0 && groupCount < MAX_OPERATION_PASSES) {
      groupCount += 1;
      // Retry with another operation group, never mix targets from different operations.
      // eslint-disable-next-line no-await-in-loop
      const { actions, operation } = await this.operationActions(currentInput, remaining);
      const otherOperations = operation !== undefined && remaining.length > actions.length;
      // Large target sets are paged by observed descriptions; System One picks the page.
      // eslint-disable-next-line no-await-in-loop
      const page = await this.pageActions(currentInput, actions, otherOperations);
      // eslint-disable-next-line no-await-in-loop
      const target = await this.targetChoice(currentInput, page, { otherOperations });
      if (!target.rejectGroup) {
        // eslint-disable-next-line no-await-in-loop
        const attempt = await this.selectAction(currentInput, {
          actions: page,
          answer: target.answer,
          started,
          optionCount: target.optionCount,
        });
        if (attempt.decision !== undefined) {
          return {
            ...attempt.decision,
            checks: [...rejectedChecks, ...attempt.checks],
            candidates: page,
            rejectedOperations,
            ...(operation === undefined ? {} : { operation }),
          };
        }
        rejectedChecks.push(...attempt.checks);
      }
      if (operation !== undefined && (!target.rejectGroup || page.length === actions.length)) {
        rejectedOperations.push(operation);
      }
      // A page-level None keeps other pages; failed candidate checks move to another operation.
      const rejected = target.rejectGroup && page.length < actions.length ? page : actions;
      remaining = remaining.filter((action) => !rejected.includes(action));
      currentInput = {
        ...input,
        feedback: [
          input.feedback ?? "",
          target.rejectGroup
            ? "The selected target group contained no action matching the request. Choose from the remaining observed targets."
            : "The previous operation yielded no approved action on this observation. Choose another available operation.",
        ]
          .filter(Boolean)
          .join("\n"),
      };
    }
    throw new ActionSelectionError(rejectedChecks, rejectedOperations, { groupCount });
  }

  private async pageActions(
    input: DecisionInput,
    actions: readonly Action[],
    otherOperations: boolean,
  ): Promise<readonly Action[]> {
    const pageSize = this.maxChoices - Number(otherOperations);
    if (actions.length <= pageSize) {
      return actions;
    }
    const pages: Action[][] = [];
    for (let index = 0; index < actions.length; index += pageSize) {
      pages.push(actions.slice(index, index + pageSize));
    }
    if (pages.length > this.maxChoices) {
      throw new Error(
        `capacity_choices: This decision model supports at most ${this.maxChoices} choice pages; ${pages.length} are needed for the current screen. Narrow the visible controls or choose another model.`,
      );
    }
    const descriptions = pages.map((page) =>
      page.map((action) => actionDescription(action, input.observation)).join(" | "),
    );
    const groups = descriptions.map((description, index) => `A${index}: ${description}`);
    const response = await this.request(input, "target-page", {
      model: this.modelId,
      state: `${decisionState(input)}\nTarget groups and their observed actions:\n${groups.join("\n")}`,
      questions: {
        next_action: {
          type: "choice",
          instructions: `Which group contains the exact observed target needed next for this request: ${input.task}?`,
          criteria: criteriaFor(groups.map((_group, index) => `Target group A${index}`)),
        },
      },
    });
    const answer = response.answers.next_action;
    if (!validProbabilities(answer.probabilities, pages.length)) {
      throw new Error("System One returned an invalid target-page distribution");
    }
    const selected = pages.find((_page, index) => `A${index}` === answer.choice);
    if (selected === undefined) {
      throw new Error("System One selected an unavailable target page");
    }
    return selected;
  }

  private async targetChoice(
    input: DecisionInput,
    actions: readonly Action[],
    options: { readonly otherOperations: boolean; readonly forceChoice?: boolean },
  ): Promise<{
    readonly answer: DecisionAnswer;
    readonly optionCount: number;
    readonly rejectGroup: boolean;
  }> {
    if (actions.length === 1 && options.forceChoice !== true) {
      // The operation choice already selected this sole target; do not ask it to veto itself.
      return {
        answer: { choice: "A0", probabilities: { A0: 1 } },
        optionCount: 1,
        rejectGroup: false,
      };
    }
    const descriptions = actions.map((action) => actionDescription(action, input.observation));
    if (options.otherOperations) {
      descriptions.push(
        "None of these targets; choose another operation without taking an action.",
      );
    }
    const payload = await this.request(input, "target", {
      model: this.modelId,
      state: decisionState(input),
      questions: {
        next_action: {
          type: "choice",
          instructions: `Which action best advances this goal: ${input.task}`,
          criteria: criteriaFor(descriptions),
        },
      },
    });
    const answer = payload.answers.next_action;
    if (!validProbabilities(answer.probabilities, descriptions.length)) {
      throw new Error("System One returned an invalid target distribution");
    }
    return {
      answer,
      optionCount: descriptions.length,
      rejectGroup: options.otherOperations && answer.choice === `A${actions.length}`,
    };
  }

  private async operationActions(
    input: DecisionInput,
    actions: readonly Action[],
  ): Promise<{ readonly actions: readonly Action[]; readonly operation?: OperationDecision }> {
    const groups = actionGroups(actions);
    const hasTargetedOperation =
      (input.observation.window !== undefined &&
        actions.some(
          (action) => action.kind === "click_element" || action.kind === "compose_text",
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
      state: decisionState(input),
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

  private async selectAction(
    input: DecisionInput,
    selection: {
      readonly actions: readonly Action[];
      readonly answer: DecisionAnswer;
      readonly started: number;
      readonly optionCount: number;
    },
  ): Promise<{ readonly decision?: Decision; readonly checks: readonly ActionCheck[] }> {
    const { actions, answer, started, optionCount } = selection;
    const initial = decision(answer, actions, {
      latencyMs: performance.now() - started,
      optionCount,
    });
    const first = await this.verifySelected(input, initial, started);
    if (first.decision !== undefined || actions.length === 1) {
      return first;
    }
    const alternatives = actions.filter((action) => action !== initial.action);
    const retryInput = {
      ...input,
      feedback: [
        input.feedback ?? "",
        "The previously selected target did not pass its action or persistent-effect check. Choose another observed target, or choose None for another operation.",
      ]
        .filter(Boolean)
        .join("\n"),
    };
    const alternate = await this.targetChoice(retryInput, alternatives, {
      otherOperations: true,
      forceChoice: true,
    });
    if (alternate.rejectGroup) {
      return first;
    }
    const next = decision(alternate.answer, alternatives, {
      latencyMs: performance.now() - started,
      optionCount: alternate.optionCount,
    });
    const second = await this.verifySelected(retryInput, next, started);
    return { ...second, checks: [...first.checks, ...second.checks] };
  }

  private async verifySelected(
    input: DecisionInput,
    selected: Decision,
    started: number,
  ): Promise<{ readonly decision?: Decision; readonly checks: readonly ActionCheck[] }> {
    const { action } = selected;
    if (action.kind === "finish") {
      return { decision: { ...selected, latencyMs: performance.now() - started }, checks: [] };
    }
    if (action.kind === "blocked") {
      return { decision: { ...selected, latencyMs: performance.now() - started }, checks: [] };
    }
    // An ordinary action match does not authorize a persistent effect.
    const commit = await verifyCommit({
      action,
      input,
      model: this.modelId,
      judge: async (query, phase) => this.judge(input, query, phase),
    });
    return commit.allowed
      ? {
          decision: { ...selected, latencyMs: performance.now() - started },
          checks: commit.checks,
        }
      : { checks: commit.checks };
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

  private async judge(
    input: DecisionInput,
    request: DecisionRequest,
    phase: DecisionRequestPhase,
  ): Promise<BinaryAnswer> {
    const response = await this.request(input, phase, request);
    const answer = binaryAnswerSchema.parse(response.answers.next_action);
    if (!validProbabilities(answer.probabilities, COMPLETION_CLASSES)) {
      throw new Error("System One returned an invalid commit verification");
    }
    return answer;
  }
}

export { SystemOneDecisionModel };
export type { Decision, DecisionInput, DecisionModel };
export type { DecisionRequestEvent } from "./decision-request.ts";
