import { afterEach, describe, expect, test } from "bun:test";
import { checkClmWeights } from "../scripts/evals/benchmark/benchmark-artifacts.ts";
import type { ArtifactSelection } from "../scripts/evals/benchmark/benchmark-artifacts.ts";
import {
  externalTargetKind,
  infrastructureGrade,
} from "../scripts/evals/benchmark/benchmark-infrastructure.ts";
import { initialStateHash } from "../scripts/evals/benchmark/benchmark-state.ts";
import {
  cases,
  grade,
  writeCounts,
  zeroWrites,
} from "../scripts/evals/benchmark/benchmark-cases.ts";
import {
  decisionPresets,
  plan,
  selectedCases,
  selectedPresets,
} from "../scripts/evals/benchmark/benchmark-plan.ts";
import { median, summarize } from "../scripts/evals/benchmark/benchmark-stats.ts";
import type { TrialRecord } from "../scripts/evals/benchmark/benchmark-stats.ts";
import { startWorkspace } from "../scripts/evals/workspace.ts";
import type { Window } from "../src/agent/contracts.ts";

const SUCCESS_MS = 12_000;
const FAILURE_MS = 1000;
const ONE_POST = 1;
const TWO_TRIALS = 2;
const SEVEN_PRESETS = 7;
const FOUR_CASES = 4;
const THREE_REPEATS = 3;
const FIRST_REQUEST_MS = 10;
const SECOND_REQUEST_MS = 20;
const EIGHTY_FOUR = 84;
const FINGERPRINT_LENGTH = 64;
const REVISION_LENGTH = 40;
const workspaces: ReturnType<typeof startWorkspace>[] = [];
function workspace(): ReturnType<typeof startWorkspace> {
  const created = startWorkspace();
  workspaces.push(created);
  return created;
}
function window(url: string, elements: Window["elements"] = []): Window {
  return {
    url,
    app_name: "Google Chrome",
    pid: 0,
    window_id: 0,
    window_title: "Fixture",
    snapshot_id: "test",
    elements,
  };
}
function trial(overrides: Partial<TrialRecord>): TrialRecord {
  return {
    modelId: "kev-4b",
    caseId: "open-document",
    trial: 1,
    outcome: "success",
    gradedOutcome: "success",
    taskStatus: "complete",
    driverErrors: [],
    guardedExternalAttempts: 0,
    taskMs: SUCCESS_MS,
    turns: 3,
    decisionRequests: 5,
    completedDecisionRequestMs: [FIRST_REQUEST_MS, SECOND_REQUEST_MS],
    textRequests: 0,
    completedTextRequestMs: [],
    writeDelta: zeroWrites,
    startedAt: "2026-09-27T00:00:00.000Z",
    endedAt: "2026-09-27T00:00:12.000Z",
    ...overrides,
  };
}
function clmArtifact(modelId: "clm-8b-q4" | "clm-8b-q8", head: string): ArtifactSelection {
  return {
    status: "resolved",
    modelId,
    lookupMs: FIRST_REQUEST_MS,
    manifest: {
      id: modelId,
      sources: [
        {
          role: "encoder",
          repository: "Qwen/Qwen3-8B",
          revision: "a".repeat(REVISION_LENGTH),
          assetFingerprint: "b".repeat(FINGERPRINT_LENGTH),
        },
        {
          role: "head",
          repository: "Contrastive-LM/CLM-v0.1-8B",
          revision: "c".repeat(REVISION_LENGTH),
          assetFingerprint: head,
        },
      ],
    },
  };
}
afterEach(async () => {
  await Promise.all(workspaces.splice(0).map(async (item) => item.close()));
});
describe("benchmark matrix", () => {
  test("covers every current decision preset with fixed Qwen and repeated fixture cases", () => {
    const matrix = plan();
    expect(decisionPresets()).toHaveLength(SEVEN_PRESETS);
    expect(cases).toHaveLength(FOUR_CASES);
    expect(matrix).toMatchObject({ trialsPerCase: THREE_REPEATS, totalTasks: EIGHTY_FOUR });
  });
  test("a bounded development plan uses one trial without changing the default matrix", () => {
    const subset = plan({
      models: selectedPresets(["kev-4b", "kev-0.8b"]),
      scenarios: selectedCases(["open-document", "fill-unsaved-draft"]),
      trialCount: 1,
    });
    expect(subset).toMatchObject({ trialsPerCase: 1, totalTasks: 4 });
    expect(plan()).toMatchObject({ trialsPerCase: THREE_REPEATS, totalTasks: EIGHTY_FOUR });
  });
  test("an early Finish fails the unsaved draft case", () => {
    const fixture = workspace();
    const scenario = cases.find((item) => item.id === "fill-unsaved-draft");
    if (scenario === undefined) {
      throw new Error("Missing draft case");
    }
    const result = grade({
      scenario,
      workspace: fixture,
      window: window(`${fixture.origin}/projects?open=1`),
      status: "complete",
      writes: zeroWrites,
    });
    expect(result).toEqual({ passed: false, failure: "wrong-result" });
  });
  test("a correct page with an unrelated write fails", () => {
    const fixture = workspace();
    const scenario = cases.find((item) => item.id === "open-document");
    if (scenario === undefined) {
      throw new Error("Missing document case");
    }
    const result = grade({
      scenario,
      workspace: fixture,
      window: window(`${fixture.origin}/item/r-8`),
      status: "complete",
      writes: { ...zeroWrites, projects: ONE_POST },
    });
    expect(result).toEqual({ passed: false, failure: "unintended-write" });
  });
  test("failed fast tasks do not enter successful task speed", () => {
    const summary = summarize("kev-4b", [
      trial({}),
      trial({ trial: TWO_TRIALS, outcome: "wrong-result", taskMs: FAILURE_MS, turns: 1 }),
    ]);
    expect(summary.successRate).toBe(1 / TWO_TRIALS);
    expect(summary.medianSuccessfulTaskSeconds).toBe(SUCCESS_MS / FAILURE_MS);
    expect(summary.medianSuccessfulTurns).toBe(THREE_REPEATS);
    expect(summary.completedDecisionRequests).toBe(FOUR_CASES);
  });
  test("median returns no speed for no completed requests", () => {
    expect(median([])).toBeUndefined();
    const unloaded = summarize("julia-1", []);
    expect(unloaded.total).toBe(0);
    expect(unloaded.successRate).toBeUndefined();
  });
  test("CLM precision arms must use the same encoder and head assets", () => {
    const shared = "d".repeat(FINGERPRINT_LENGTH);
    const q4 = clmArtifact("clm-8b-q4", shared);
    const q8 = clmArtifact("clm-8b-q8", shared);
    expect(() => {
      checkClmWeights([q4, q8]);
    }).not.toThrow();
    expect(() => {
      checkClmWeights([q4, clmArtifact("clm-8b-q8", "e".repeat(FINGERPRINT_LENGTH))]);
    }).toThrow("different head assets");
  });
});
describe("fixture isolation", () => {
  test("fixture reset preserves origin and restores writes and document content", async () => {
    const fixture = workspace();
    const originalOrigin = fixture.origin;
    const response = await fetch(`${fixture.origin}/save`, {
      method: "POST",
      body: new URLSearchParams({ id: "r-8", body: "Changed in QA" }),
    });
    expect(response.ok).toBe(true);
    expect(fixture.saves()).toBe(ONE_POST);
    fixture.reset();
    expect(fixture.origin).toBe(originalOrigin);
    expect(fixture.saves()).toBe(0);
    expect(fixture.document("r-8")?.body).toBe("Discuss milestones on Tuesday.");
  });
  test("a resolved click that times out is infrastructure-invalid even when writes are missing", () => {
    const step = {
      error: "Playwright browser_click failed: TimeoutError: locator resolved but was not visible",
    };
    const graded = infrastructureGrade("wrong-write-count", [step]);
    expect(graded.outcome).toBe("infrastructure-invalid");
    expect(graded.driverErrors).toHaveLength(1);
  });
  test("a rejected external URL stays bounded; an observed escape stops the matrix", () => {
    expect(
      externalTargetKind("The model selected a URL outside the disposable localhost fixture."),
    ).toBe("blocked-target");
    expect(
      externalTargetKind(
        "The model left the disposable localhost fixture; the evaluation stopped.",
      ),
    ).toBe("observed-escape");
  });
});
describe("full fixture reset", () => {
  test("reset restores every fixture write and the initial logical state hash", async () => {
    const fixture = workspace();
    const initial = initialStateHash(fixture, window(`${fixture.origin}/`));
    await Promise.all([
      fetch(`${fixture.origin}/save`, {
        method: "POST",
        body: new URLSearchParams({ id: "r-8", body: "Changed in QA" }),
      }),
      fetch(`${fixture.origin}/profile`, {
        method: "POST",
        body: new URLSearchParams({
          displayName: "QA",
          summary: "Changed",
          priority: "high",
          updates: "on",
          visibility: "private",
        }),
      }),
      fetch(`${fixture.origin}/projects`, {
        method: "POST",
        body: new URLSearchParams({ name: "Temporary" }),
      }),
      fetch(`${fixture.origin}/projects/cancel`, {
        method: "POST",
        body: new URLSearchParams({ name: "Cancelled" }),
      }),
      fetch(`${fixture.origin}/volatile`, { method: "POST" }),
      fetch(`${fixture.origin}/select-values`, {
        method: "POST",
        body: new URLSearchParams({ priority: "high-priority" }),
      }),
      fetch(`${fixture.origin}/select-duplicate`, {
        method: "POST",
        body: new URLSearchParams({ priority: "external-high" }),
      }),
    ]);
    expect(initialStateHash(fixture, window(`${fixture.origin}/`))).not.toBe(initial);
    fixture.reset();
    expect(writeCounts(fixture)).toEqual(zeroWrites);
    expect(initialStateHash(fixture, window(`${fixture.origin}/`))).toBe(initial);
    const [documentPage, projectPage, profilePage] = await Promise.all([
      fetch(`${fixture.origin}/item/r-8`).then(async (response) => response.text()),
      fetch(`${fixture.origin}/projects`).then(async (response) => response.text()),
      fetch(`${fixture.origin}/profile`).then(async (response) => response.text()),
    ]);
    expect(documentPage).toContain("Discuss milestones on Tuesday.");
    expect(projectPage).not.toContain("Temporary");
    expect(profilePage).toContain("Initial name");
  });
});
