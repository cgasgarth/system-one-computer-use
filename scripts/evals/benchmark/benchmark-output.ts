import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { TrialOutcome } from "./benchmark-trial.ts";
import type { TrialRecord } from "./benchmark-stats.ts";

const MS_PER_SECOND = 1000;
const SECONDS_DIGITS = 1;
const FIXTURE_BASE_FILES = [
  "scripts/evals/benchmark.ts",
  "scripts/evals/workspace.ts",
  "scripts/evals/restricted-browser.ts",
] as const;
async function fixtureHash(): Promise<string> {
  const digest = new Bun.CryptoHasher("sha256");
  const files: string[] = [...FIXTURE_BASE_FILES];
  for await (const file of new Bun.Glob("benchmark/*.ts").scan({
    cwd: "scripts/evals",
    onlyFiles: true,
  })) {
    files.push(`scripts/evals/${file}`);
  }
  for (const file of files.toSorted()) {
    digest.update(file);
    // The file list is fixed, so the digest is stable for this source revision.
    // oxlint-disable-next-line no-await-in-loop
    digest.update(await Bun.file(file).arrayBuffer());
  }
  return digest.digest("hex");
}
async function recordTrial(output: string, trial: Readonly<TrialRecord>): Promise<void> {
  await appendFile(path.join(output, "trials.jsonl"), `${JSON.stringify(trial)}\n`);
  console.log(
    JSON.stringify({
      model: trial.modelId,
      case: trial.caseId,
      trial: trial.trial,
      outcome: trial.outcome,
      seconds: Number((trial.taskMs / MS_PER_SECOND).toFixed(SECONDS_DIGITS)),
      turns: trial.turns,
      writes: trial.writeDelta,
    }),
  );
}
async function recordEvidence(output: string, outcome: Readonly<TrialOutcome>): Promise<void> {
  const { record, trace, decisionEvents } = outcome;
  const folder = path.join(output, "traces", record.modelId);
  await mkdir(folder, { recursive: true });
  await Bun.write(
    path.join(folder, `${record.caseId}-trial-${record.trial}.json`),
    JSON.stringify({ record, trace, decisionEvents }),
  );
}
export { fixtureHash, recordEvidence, recordTrial };
