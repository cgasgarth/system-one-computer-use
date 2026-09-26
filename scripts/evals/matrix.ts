import { z } from "zod";

const cases = [
  "open-document",
  "finish-freshness",
  "edit-and-save",
  "follow-up",
  "multi-field-profile",
  "modal-cancel",
  "modal-create",
  "rerendered-button",
  "read-only-dialog",
  "prefilled-editor-open",
  "fill-unsaved-draft",
  "follow-up-button",
  "follow-up-tab",
  "follow-up-row",
  "long-page-target",
  "select-underlying-value",
  "select-duplicate-label",
] as const;
const label = Bun.env["EVAL_MATRIX_LABEL"] ?? "current";
const requested = Bun.env["EVAL_MATRIX_CASES"]?.split(",");
const runId = crypto.randomUUID();
const directory = `runs/qa/overnight/matrix/${label}/${runId}`;
const ERROR_CHARS = 500;
const artifactIdentity = z.object({
  case: z.string(),
  runId: z.string(),
  sourceHash: z.string(),
  fixtureHash: z.string(),
});
function parseSummary(line: string | undefined): unknown {
  try {
    return line === undefined ? {} : JSON.parse(line);
  } catch {
    return {};
  }
}
async function readIdentity(
  file: Readonly<ReturnType<typeof Bun.file>>,
): Promise<z.infer<typeof artifactIdentity>> {
  if (!(await file.exists())) {
    return { case: "", runId: "", sourceHash: "", fixtureHash: "" };
  }
  return artifactIdentity.parse(await file.json());
}
const results = [];
const startedAt = new Date().toISOString();
for (const name of cases.filter((item) => requested?.includes(item) ?? true)) {
  const child = Bun.spawn(["bun", "scripts/evals/browser-tasks.ts"], {
    env: { ...Bun.env, EVAL_CASE: name, EVAL_RUN_ID: runId, EVAL_OUTPUT_DIR: directory },
    stdout: "pipe",
    stderr: "pipe",
  });
  // Cases must run one at a time because they share the Chrome extension session.
  // eslint-disable-next-line no-await-in-loop
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  const line = stdout.trim().split("\n").at(-1);
  const summary = parseSummary(line);
  const artifactPath = `${directory}/${name}.json`;
  const artifact = Bun.file(artifactPath);
  // The case output must be new, match this run ID, and contain both content hashes.
  // eslint-disable-next-line no-await-in-loop
  const identity = await readIdentity(artifact);
  const validArtifact = identity.case === name && identity.runId === runId;
  const result = {
    case: name,
    exitCode,
    summary,
    error: stderr.trim().slice(0, ERROR_CHARS),
    artifact: validArtifact ? artifactPath : "missing or mismatched artifact",
    sourceHash: identity.sourceHash,
    fixtureHash: identity.fixtureHash,
  };
  results.push(result);
  console.log(JSON.stringify({ case: name, exitCode, validArtifact }));
}
await Bun.write(
  `${directory}/results.json`,
  JSON.stringify({ runId, label, startedAt, endedAt: new Date().toISOString(), results }),
  { createPath: true },
);
console.log(JSON.stringify({ runId, directory, cases: results.length }));
process.exitCode = Number(
  results.some(
    (result) => result.exitCode !== 0 || result.artifact === "missing or mismatched artifact",
  ),
);
