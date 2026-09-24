import { expect, test } from "bun:test";
import { decisionMetrics } from "../src/app/decision-metrics.ts";

const TIMINGS = [
  { decisionMs: 100, actionMs: 200, elapsedMs: 5300 },
  { decisionMs: 1000, actionMs: 200, elapsedMs: 6600 },
  { decisionMs: 200, actionMs: 200, elapsedMs: 7100 },
];
const ODD_MEDIAN = 200;
const EVEN_MEDIAN = 550;
const ACTIVE_SECONDS = 2.1;
const PAIR_LENGTH = 2;
test("shows median latency and execution throughput without initial planning", () => {
  const metrics = decisionMetrics(TIMINGS);
  expect(metrics.medianDecisionMs).toBe(ODD_MEDIAN);
  expect(metrics.modelActionsPerSecond).toBeCloseTo(TIMINGS.length / ACTIVE_SECONDS);
  expect(decisionMetrics(TIMINGS.slice(0, PAIR_LENGTH)).medianDecisionMs).toBe(EVEN_MEDIAN);
});
test("leaves metrics unset until a decision completes", () => {
  expect(decisionMetrics([])).toEqual({
    medianDecisionMs: undefined,
    modelActionsPerSecond: undefined,
  });
});
