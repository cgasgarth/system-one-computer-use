import { expect, test } from "bun:test";
import { decisionMetrics } from "../src/app/decision-metrics.ts";

const TIMINGS = [
  { performedAction: true, decisionMs: 100, actionMs: 200, elapsedMs: 5300 },
  { performedAction: true, decisionMs: 1000, actionMs: 200, elapsedMs: 6600 },
  { performedAction: true, decisionMs: 200, actionMs: 200, elapsedMs: 7100 },
];
const HUNDRED = 100;
const THOUSAND = 1000;
const TWO_HUNDRED = 200;
const STALLED_SECONDS = 94;
const REQUEST_MS = [HUNDRED, THOUSAND, TWO_HUNDRED];
const ODD_MEDIAN = 200;
const EVEN_MEDIAN = 550;
const TOTAL_SECONDS = 7.1;
const PAIR_LENGTH = 2;
test("shows actual model request median and completed action throughput over the whole task", () => {
  const metrics = decisionMetrics({
    steps: TIMINGS,
    elapsedMs: TOTAL_SECONDS * THOUSAND,
    decisionRequestMs: REQUEST_MS,
  });
  expect(metrics.medianDecisionMs).toBe(ODD_MEDIAN);
  expect(metrics.modelActionsPerSecond).toBeCloseTo(TIMINGS.length / TOTAL_SECONDS);
  expect(
    decisionMetrics({
      steps: TIMINGS.slice(0, PAIR_LENGTH),
      elapsedMs: TOTAL_SECONDS * THOUSAND,
      decisionRequestMs: REQUEST_MS.slice(0, PAIR_LENGTH),
    }).medianDecisionMs,
  ).toBe(EVEN_MEDIAN);
});
test("leaves metrics unset until a decision completes", () => {
  expect(decisionMetrics({ steps: [], elapsedMs: 0, decisionRequestMs: [] })).toEqual({
    medianDecisionMs: undefined,
    modelActionsPerSecond: undefined,
  });
});

test("reports zero tool throughput for cached decisions whose tools failed", () => {
  const failed = TIMINGS.map((step) => ({
    actionMs: step.actionMs,
    elapsedMs: step.elapsedMs,
    decisionMs: 1,
    performedAction: false,
  }));
  const metrics = decisionMetrics({
    steps: failed,
    elapsedMs: STALLED_SECONDS * THOUSAND,
    decisionRequestMs: [1],
  });
  expect(metrics.medianDecisionMs).toBe(1);
  expect(metrics.modelActionsPerSecond).toBe(0);
});

test("a stalled request keeps prior action throughput tied to current elapsed time", () => {
  const metrics = decisionMetrics({
    steps: TIMINGS.slice(0, 1),
    elapsedMs: STALLED_SECONDS * THOUSAND,
    decisionRequestMs: [HUNDRED],
  });
  expect(metrics.modelActionsPerSecond).toBeCloseTo(1 / STALLED_SECONDS);
});
