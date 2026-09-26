import { actionDescription, actionGroups, targetCorrectionActions } from "./action-space.ts";
import type { OperationDecision } from "./action-space.ts";
import { isEditableElement } from "../agent/contracts.ts";
import { relevantControls, textTargetName } from "../agent/controls.ts";
import type { Action, ActionChoices, Observation, Window } from "../agent/contracts.ts";
import type { ClickInspection } from "../computer/types.ts";
import { requestJson } from "./request.ts";
import { verificationRequest } from "./decision-verification.ts";
import { hasPendingDialogDraft } from "./completion-evidence.ts";
import { ActionSelectionError } from "./action-selection-error.ts";
import { verifyCommit } from "./commit-verification.ts";
import type { ActionCheck } from "./decision-verification.ts";
import { binaryAnswerSchema, decisionResponseSchema } from "./system-one-schema.ts";
import type {
  ActionCriteria,
  ActionProbabilities,
  BinaryAnswer,
  DecisionAnswer,
  DecisionRequest,
  DecisionResponse,
} from "./system-one-schema.ts";

const TIMEOUT_MS = 10_000;
const MAX_CONTROLS = 100;
const LONG_LIST_PRIMARY_CONTROLS = 35;
const LONG_LIST_SUMMARY_CHARS = 3000;
const LONG_LIST_HALVES = 2;
const LONG_LIST_HALF_CHARS = LONG_LIST_SUMMARY_CHARS / LONG_LIST_HALVES;
const MAX_FIELD_CHARS = 100;
const MAX_STATE_CHARS = 6000;
const MIN_STATE_CHARS = 1200;
const PROBABILITY_TOLERANCE = 0.02;
const COMPLETION_CLASSES = 2;
const COMPLETION_THRESHOLD = 0.6;
const DRAFT_COMPLETION_THRESHOLD = 0.5;
const ACTION_MATCH_THRESHOLD = 0.8;
const TEXT_CONTENT = new Set([
  "AXStaticText",
  "AXTextArea",
  "text",
  "paragraph",
  "heading",
  "listitem",
]);

interface Decision {
  readonly action: Action;
  readonly latencyMs: number;
  readonly probabilities: ActionProbabilities;
  readonly completion?: BinaryAnswer;
  readonly completionTarget?: BinaryAnswer;
  readonly completionCommit?: BinaryAnswer;
  readonly checks?: readonly ActionCheck[];
  readonly operation?: OperationDecision;
  readonly rejectedOperations?: readonly OperationDecision[];
  readonly candidates?: readonly Action[];
}

interface DecisionInput {
  readonly task: string;
  readonly observation: Observation;
  readonly actions: ActionChoices;
  readonly context?: string;
  readonly feedback?: string;
  readonly completionEvidence?: string;
  readonly inspectClick?: (
    action: Extract<Action, { kind: "click_element" }>,
  ) => Promise<ClickInspection>;
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
  if (isEditableElement(element)) {
    return `Editable text field ${JSON.stringify(textTargetName(element))}: current text ${JSON.stringify(value.slice(0, MAX_FIELD_CHARS))}`;
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
      const available = observation.desktop.windows.some(
        (window) => window.pid === observation.application?.pid,
      );
      return `Selected application: ${observation.application.name}. ${available ? "Choose one of its available windows." : "It is running without a controllable window."}\nAvailable windows: ${windows}`;
    }
    return `Windows: ${windows}\nNo window selected.`;
  }
  const allControls = relevantControls(current);
  const controls = allControls
    .slice(0, allControls.length > MAX_CONTROLS ? LONG_LIST_PRIMARY_CONTROLS : MAX_CONTROLS)
    .map((element) => describeControl(element))
    .join("\n");
  const remaining =
    allControls.length > MAX_CONTROLS ? allControls.slice(LONG_LIST_PRIMARY_CONTROLS) : [];
  const laterControls = remaining
    .filter((element) => (element.actions ?? []).length > 0)
    .map((element) => `${element.role} ${JSON.stringify(element.label ?? "")}`)
    .join(" | ");
  const laterSummary =
    laterControls.length <= LONG_LIST_SUMMARY_CHARS
      ? laterControls
      : `${laterControls.slice(0, LONG_LIST_HALF_CHARS)} ... ${laterControls.slice(-LONG_LIST_HALF_CHARS)}`;
  const lines = [
    `Current window: ${current.app_name}: ${current.window_title}`,
    ...(current.url === undefined ? [] : [`Current URL: ${current.url}`]),
    `Visible controls and values: ${controls.slice(0, Math.max(MIN_STATE_CHARS, MAX_STATE_CHARS - contextLength))}`,
    ...(remaining.length === 0
      ? []
      : [`Further actionable controls (${remaining.length} later rows): ${laterSummary}`]),
  ];
  return lines.join("\n");
}

function decisionState(input: DecisionInput): string {
  const state = [`User request: ${input.task}`];
  if (input.context !== undefined && input.context.length > 0) {
    state.push(input.context);
  }
  if (input.feedback !== undefined && input.feedback.length > 0) {
    state.push(input.feedback);
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

function finishEligible(
  complete: boolean,
  target: BinaryAnswer | undefined,
  commit: BinaryAnswer | undefined,
): boolean {
  return (
    complete &&
    (target === undefined ||
      (target.choice === "A0" && (target.probabilities["A0"] ?? 0) >= ACTION_MATCH_THRESHOLD)) &&
    (commit === undefined ||
      (commit.choice === "A1" && (commit.probabilities["A1"] ?? 0) >= ACTION_MATCH_THRESHOLD))
  );
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

  // Completion evidence has independent checks for target and unsubmitted dialog state.
  // eslint-disable-next-line eslint/complexity
  public async choose(input: DecisionInput): Promise<Decision> {
    const checkCompletion =
      input.observation.window !== undefined || input.observation.application !== undefined;
    const start = performance.now();
    const completion = checkCompletion ? await this.checkCompletion(input) : undefined;
    const pendingDraft = hasPendingDialogDraft(input.observation.window);
    const complete =
      completion?.choice === "A0" &&
      (completion.probabilities["A0"] ?? 0) >=
        (pendingDraft ? DRAFT_COMPLETION_THRESHOLD : COMPLETION_THRESHOLD);
    const completionTarget =
      complete && (input.context?.length ?? 0) > 0
        ? await this.checkCompletionTarget(input)
        : undefined;
    const completionCommit =
      complete && pendingDraft ? await this.checkCompletionCommit(input) : undefined;
    if (completion !== undefined && finishEligible(complete, completionTarget, completionCommit)) {
      const action = input.actions.find((candidate) => candidate.kind === "finish");
      if (action === undefined) {
        throw new Error("The completion decision has no Finish option");
      }
      return {
        action,
        completion,
        ...(completionTarget === undefined ? {} : { completionTarget }),
        ...(completionCommit === undefined ? {} : { completionCommit }),
        probabilities: completion.probabilities,
        latencyMs: performance.now() - start,
      };
    }
    const available = checkCompletion
      ? input.actions.filter((action) => action.kind !== "finish")
      : input.actions;
    const selected = await this.chooseAvailable(
      input,
      completionTarget !== undefined &&
        (completionTarget.choice === "A1" ||
          (completionTarget.probabilities["A0"] ?? 0) < ACTION_MATCH_THRESHOLD)
        ? targetCorrectionActions({
            actions: available,
            observation: input.observation,
          })
        : available,
      start,
    );
    return {
      ...selected,
      ...(completion === undefined ? {} : { completion }),
      ...(completionTarget === undefined ? {} : { completionTarget }),
      ...(completionCommit === undefined ? {} : { completionCommit }),
    };
  }

  private async chooseAvailable(
    input: DecisionInput,
    available: readonly Action[],
    started: number,
  ): Promise<Decision> {
    let remaining = available;
    const rejectedOperations: OperationDecision[] = [];
    const rejectedChecks: ActionCheck[] = [];
    let groupCount = 0;
    while (remaining.length > 0) {
      groupCount += 1;
      // Each retry excludes the rejected operation before asking the model again.
      // eslint-disable-next-line no-await-in-loop
      const { actions, operation } = await this.operationActions(input, remaining);
      // eslint-disable-next-line no-await-in-loop
      const payload = await this.request({
        model: this.modelId,
        state: decisionState(input),
        questions: {
          next_action: {
            type: "choice",
            instructions: `Which action best advances this goal: ${input.task}`,
            criteria: criteriaFor(
              actions.map((action) => actionDescription(action, input.observation)),
            ),
          },
        },
      });
      // eslint-disable-next-line no-await-in-loop
      const attempt = await this.selectAction(input, {
        actions,
        answer: payload.answers.next_action,
        started,
      });
      if (attempt.decision !== undefined) {
        return {
          ...attempt.decision,
          checks: [...rejectedChecks, ...attempt.checks],
          candidates: actions,
          rejectedOperations,
          ...(operation === undefined ? {} : { operation }),
        };
      }
      rejectedChecks.push(...attempt.checks);
      if (operation !== undefined) {
        rejectedOperations.push(operation);
      }
      remaining = remaining.filter((action) => !actions.includes(action));
    }
    throw new ActionSelectionError(rejectedChecks, rejectedOperations, groupCount);
  }

  private async operationActions(
    input: DecisionInput,
    actions: readonly Action[],
  ): Promise<{ readonly actions: readonly Action[]; readonly operation?: OperationDecision }> {
    const groups = actionGroups(actions);
    if (
      input.observation.window === undefined ||
      !actions.some(
        (action) => action.kind === "click_element" || action.kind === "compose_text",
      ) ||
      groups.length <= 1
    ) {
      return { actions };
    }
    const descriptions = groups.map((group) => group.description);
    const response = await this.request({
      model: this.modelId,
      state: decisionState(input),
      questions: {
        next_action: {
          type: "choice",
          instructions: "Which operation is needed next to fulfill the user request?",
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
    return { actions: group.actions, operation: { options: descriptions, answer } };
  }

  // Candidate checks include a separate persistent-effect gate before execution.
  // eslint-disable-next-line eslint/max-statements
  private async selectAction(
    input: DecisionInput,
    selection: {
      readonly actions: readonly Action[];
      readonly answer: DecisionAnswer;
      readonly started: number;
    },
  ): Promise<{ readonly decision?: Decision; readonly checks: readonly ActionCheck[] }> {
    const { actions, answer, started } = selection;
    const initial = decision(answer, actions, performance.now() - started);
    const ranked = actions
      .map((action, index) => ({ action, probability: answer.probabilities[`A${index}`] ?? 0 }))
      .toSorted((left, right) => right.probability - left.probability);
    const candidates = [
      initial.action,
      ...ranked.filter((entry) => entry.action !== initial.action).map((entry) => entry.action),
    ];
    const checks: ActionCheck[] = [];
    const observable =
      input.observation.window !== undefined || input.observation.application !== undefined;
    for (const action of candidates.filter(
      (candidate) => candidate.kind !== "finish" || observable,
    )) {
      const request = verificationRequest(action, input, this.modelId);
      if (request === undefined) {
        return { decision: { ...initial, action, latencyMs: performance.now() - started }, checks };
      }
      // Each check depends on the result of the previous candidate check.
      // eslint-disable-next-line no-await-in-loop
      const response = await this.request(request);
      const check = binaryAnswerSchema.parse(response.answers.next_action);
      if (!validProbabilities(check.probabilities, COMPLETION_CLASSES)) {
        throw new Error("System One returned an invalid action verification");
      }
      checks.push({ action, answer: check });
      if (
        check.choice === "A0" &&
        (action.kind !== "click_element" ||
          (check.probabilities["A0"] ?? 0) >= ACTION_MATCH_THRESHOLD)
      ) {
        // The ordinary action match does not establish that a persistent click is authorized.
        // eslint-disable-next-line no-await-in-loop
        const commit = await verifyCommit({
          action,
          input,
          model: this.modelId,
          judge: async (query) => this.judge(query),
        });
        checks.push(...commit.checks);
        if (commit.allowed) {
          return {
            decision: { ...initial, action, latencyMs: performance.now() - started },
            checks,
          };
        }
      }
    }
    return { checks };
  }

  private async checkCompletion(input: DecisionInput): Promise<BinaryAnswer> {
    const { window } = input.observation;

    const values = (window === undefined ? [] : relevantControls(window))
      .filter(
        (element) =>
          (element.value !== undefined && element.value !== null && element.value !== "") ||
          element.selected === true ||
          TEXT_CONTENT.has(element.role),
      )
      .map((element) => describeControl(element))
      .join(" | ");
    const state = [
      `User request: ${input.task}`,
      `Observed result: ${window?.app_name ?? input.observation.application?.name} is open.`,
      window === undefined
        ? "No controllable window is available."
        : `Window title: ${window.window_title}.`,
      ...(window?.url === undefined ? [] : [`Current URL: ${window.url}`]),
      `Control values: ${values.slice(0, MAX_STATE_CHARS)}`,
      ...(input.context === undefined
        ? []
        : [`Previous session context (reference only): ${input.context}`]),
      ...(input.completionEvidence === undefined
        ? []
        : [`Executed actions in this request: ${input.completionEvidence}`]),
      ...(window?.elements.some((element) =>
        ["AXPopover", "AXSheet", "AXDialog"].includes(element.role),
      ) === true
        ? [
            "A dialog or popover is still open. Its text fields can contain unsubmitted input. Verify the requested creation, saving, or submission before declaring completion.",
          ]
        : []),
    ].join("\n");
    const response = await this.request({
      model: this.modelId,
      state,
      questions: {
        next_action: {
          type: "choice",
          instructions: `Has this user request been completed: ${input.task}?`,
          criteria: {
            A0: "true: The request is complete.",
            A1: "false: The request is not complete.",
          },
        },
      },
    });
    const answer = binaryAnswerSchema.parse(response.answers.next_action);
    if (!validProbabilities(answer.probabilities, COMPLETION_CLASSES)) {
      throw new Error("System One returned an invalid completion decision");
    }
    return answer;
  }

  private async checkCompletionTarget(input: DecisionInput): Promise<BinaryAnswer> {
    const { window } = input.observation;
    const contents =
      window?.elements.map((element) => describeControl(element)).join(" | ") ??
      "No window selected.";
    const response = await this.request({
      model: this.modelId,
      state: [
        `User request: ${input.task}`,
        `Previous session context: ${input.context ?? ""}`,
        `Executed actions in this request: ${input.completionEvidence ?? ""}`,
        `Current window: ${window?.window_title ?? input.observation.application?.name ?? "None"}`,
        `Current content: ${contents.slice(0, MAX_STATE_CHARS)}`,
      ].join("\n"),
      questions: {
        next_action: {
          type: "choice",
          instructions:
            "Does the current page or document match the user's intended target, considering the current request and previous session context?",
          criteria: { A0: "Yes", A1: "No" },
        },
      },
    });
    const answer = binaryAnswerSchema.parse(response.answers.next_action);
    if (!validProbabilities(answer.probabilities, COMPLETION_CLASSES)) {
      throw new Error("System One returned an invalid target verification");
    }
    return answer;
  }

  private async checkCompletionCommit(input: DecisionInput): Promise<BinaryAnswer> {
    const controls =
      input.observation.window?.elements.map((element) => describeControl(element)).join(" | ") ??
      "";
    const response = await this.request({
      model: this.modelId,
      state: [
        `User request: ${input.task}`,
        `Current open dialog: ${controls.slice(0, MAX_STATE_CHARS)}`,
        `Prior task context: ${input.context ?? ""}`,
        `Executed actions in this request: ${input.completionEvidence ?? ""}`,
        "Text shown in an open dialog can be an unsubmitted draft. Do not infer a saved result from field contents alone.",
      ].join("\n"),
      questions: {
        next_action: {
          type: "choice",
          instructions:
            "Does the user's requested final result require a committed change beyond the values currently shown in this open dialog?",
          criteria: {
            A0: "Yes. The user requested a created, saved, or submitted result that is not yet observed.",
            A1: "No. The user requested this dialog or an unsubmitted draft as the final state.",
          },
        },
      },
    });
    const answer = binaryAnswerSchema.parse(response.answers.next_action);
    if (!validProbabilities(answer.probabilities, COMPLETION_CLASSES)) {
      throw new Error("System One returned an invalid commit verification");
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

  private async judge(request: DecisionRequest): Promise<BinaryAnswer> {
    const response = await this.request(request);
    const answer = binaryAnswerSchema.parse(response.answers.next_action);
    if (!validProbabilities(answer.probabilities, COMPLETION_CLASSES)) {
      throw new Error("System One returned an invalid commit verification");
    }
    return answer;
  }
}

export { SystemOneHttpDecisionModel };
export type { Decision, DecisionInput, DecisionModel };
