import { z } from "zod";
import type { ReadonlyDeep } from "type-fest";
import { actionSchema, desktopSchema, windowSchema } from "../../src/agent/contracts.ts";
import { SystemOneDecisionModel } from "../../src/models/system-one.ts";
import { requestJson } from "../../src/models/request.ts";
import { socketPaths } from "../../src/app/models/sockets.ts";
import {
  decisionRequestSchema,
  decisionResponseSchema,
} from "../../src/models/system-one-schema.ts";
import { loadConfig } from "../../src/app/config.ts";
import type { Config } from "../../src/app/config.ts";
import type { DecisionInput } from "../../src/models/system-one.ts";
import { sourceHash } from "./provenance.ts";

const MAX_CASES = 20;
const JSON_INDENT = 2;
const REQUEST_TIMEOUT_MS = 20_000;
const ARGUMENT_START = 2;
const DATA = "/Users/cgas/Library/Application Support/SystemOneComputerUse";
const CORPUS = "runs/recovery/provider-compare-corpus.json";
const PRIOR = "runs/research/overnight/precision-requests.json";
const CALENDAR =
  "runs/qa/overnight/resume-MD8rhM/kev-calendar-44b4e141-9915-4347-a52a-f39e650d60fe.json";
const OPTIMUS = "runs/recovery/optimus-open-decision-inputs.json";
const EXPECTED = new Map([
  ["target/document-open/0", "A1"],
  ["target/new-project/0", "A1"],
  ["target/save-ready/0", "A1"],
  ["target/cancel-ready/0", "A0"],
  ["target/choice/0", "A2"],
  ["effect/binary/save-document", "A0"],
  ["effect/binary/create-project", "A0"],
  ["effect/binary/cancel", "A1"],
  ["permission/draft-only/required", "A1"],
  ["permission/create-save/required", "A0"],
  ["permission/edit-save/required", "A0"],
  ["permission/view-only/required", "A1"],
]);
const wireSchema = z.object({
  kind: z.literal("wire"),
  id: z.string(),
  source: z.string(),
  expectedChoice: z.string(),
  body: decisionRequestSchema,
});
const decisionInputSchema = z.object({
  task: z.string(),
  context: z.string().optional(),
  feedback: z.string().optional(),
  mode: z.enum(["browser", "desktop"]).optional(),
  observation: z.object({
    desktop: desktopSchema,
    application: desktopSchema.shape.apps.element.optional(),
    window: windowSchema.optional(),
  }),
  actions: z.array(actionSchema).nonempty(),
});
const decisionCaseSchema = z.object({
  kind: z.literal("decision"),
  id: z.string(),
  source: z.string(),
  expectedFinish: z.boolean(),
  input: decisionInputSchema,
});
const caseSchema = z.discriminatedUnion("kind", [wireSchema, decisionCaseSchema]);
const corpusSchema = z.object({
  createdAt: z.string(),
  sourceHash: z.string(),
  cases: z.array(caseSchema).min(1).max(MAX_CASES),
});
const resultSchema = z.object({
  provider: z.string(),
  corpusHash: z.string(),
  sourceHash: z.string(),
  wireOnly: z.boolean().optional(),
  rows: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(["wire", "decision"]),
      selected: z.string().optional(),
      correct: z.boolean(),
    }),
  ),
});
type Case = z.infer<typeof caseSchema>;

function sha256(value: string): string {
  return new Bun.CryptoHasher("sha256").update(value).digest("hex");
}

async function build(): Promise<void> {
  const prior = z
    .array(z.object({ id: z.string(), body: decisionRequestSchema }))
    .parse(await Bun.file(PRIOR).json());
  const cases: Case[] = prior
    .filter((item) => EXPECTED.has(item.id))
    .map((item) => ({
      kind: "wire",
      id: item.id,
      source: PRIOR,
      expectedChoice: EXPECTED.get(item.id) ?? "",
      body: item.body,
    }));
  if (cases.length !== EXPECTED.size) {
    throw new Error("A required frozen browser request is missing");
  }
  const calendar = z
    .object({ operationRequest: decisionRequestSchema, flatRequest: decisionRequestSchema })
    .parse(await Bun.file(CALENDAR).json());
  cases.push(
    {
      kind: "wire",
      id: "native/calendar-operation",
      source: CALENDAR,
      expectedChoice: "A4",
      body: calendar.operationRequest,
    },
    {
      kind: "wire",
      id: "native/calendar-flat-target",
      source: CALENDAR,
      expectedChoice: "A65",
      body: calendar.flatRequest,
    },
  );
  if (await Bun.file(OPTIMUS).exists()) {
    const captured = z
      .object({
        cases: z.array(
          z.object({ id: z.string(), expectedFinish: z.boolean(), input: decisionInputSchema }),
        ),
      })
      .parse(await Bun.file(OPTIMUS).json());
    cases.push(
      ...captured.cases.map((item): Case => ({
        kind: "decision",
        id: item.id,
        source: OPTIMUS,
        expectedFinish: item.expectedFinish,
        input: item.input,
      })),
    );
  }
  const corpus = corpusSchema.parse({
    createdAt: new Date().toISOString(),
    sourceHash: await sourceHash(),
    cases,
  });
  await Bun.write(CORPUS, JSON.stringify(corpus, undefined, JSON_INDENT), { createPath: true });
  console.log(
    JSON.stringify({
      corpus: CORPUS,
      cases: cases.length,
      optimus: cases.some((item) => item.kind === "decision"),
      hash: sha256(JSON.stringify(cases)),
    }),
  );
}

function output(command: readonly string[]): string {
  // This bounded CLI only reads model process metadata before making requests.
  // eslint-disable-next-line node/no-sync
  const result = Bun.spawnSync([...command]);
  if (result.exitCode !== 0) {
    throw new Error(`${command[0]} failed: ${result.stderr.toString().trim()}`);
  }
  return result.stdout.toString().trim();
}

async function runtime(provider: "clm" | "kev"): Promise<{
  model: string;
  selection: string;
  pid: string;
  command: string;
}> {
  const settings = z
    .object({ decision: z.object({ source: z.string(), id: z.string() }) })
    .parse(await Bun.file(`${DATA}/models.json`).json());
  const selection = provider === "clm" ? "clm-8b-q4" : "kev-4b";
  if (settings.decision.source !== "local" || settings.decision.id !== selection) {
    throw new Error(`Select ${selection} in the installed app and wait for Ready before replay`);
  }
  const socket = socketPaths(DATA).decision;
  const pids = output(["lsof", "-nP", "-t", socket]).split("\n").filter(Boolean);
  if (pids.length !== 1 || pids[0] === undefined) {
    throw new Error(`Expected one app-managed decision listener on ${socket}`);
  }
  const command = output(["ps", "-p", pids[0], "-o", "args="]);
  const expected = provider === "clm" ? "--provider clm" : "--provider kev";
  const checkpoint = "--run jaredpalmer/kev-4b@139fdd94f1b6a6ad80cc15e08fcb99cac885a101";
  if (
    !command.includes("local-bridge/serve.py") ||
    !command.includes(expected) ||
    !command.includes(`--socket ${socket}`) ||
    (provider === "clm" && !command.includes("--bits 4")) ||
    (provider === "kev" && !command.includes(checkpoint))
  ) {
    throw new Error(`Decision listener does not match ${selection}`);
  }
  return {
    model: provider === "clm" ? "clm-latest" : "kev-latest",
    selection,
    pid: pids[0],
    command,
  };
}

function asDecisionInput(input: ReadonlyDeep<z.infer<typeof decisionInputSchema>>): DecisionInput {
  const [first, ...rest] = input.actions;
  if (first === undefined) {
    throw new Error("Decision input has no actions");
  }
  return {
    task: input.task,
    observation: {
      desktop: input.observation.desktop,
      ...(input.observation.application === undefined
        ? {}
        : { application: input.observation.application }),
      ...(input.observation.window === undefined ? {} : { window: input.observation.window }),
    },
    actions: [first, ...rest],
    ...(input.context === undefined ? {} : { context: input.context }),
    ...(input.feedback === undefined ? {} : { feedback: input.feedback }),
    ...(input.mode === undefined ? {} : { mode: input.mode }),
  };
}

async function runWire(
  item: ReadonlyDeep<z.infer<typeof wireSchema>>,
  modelId: string,
  config: Config,
): Promise<{
  id: string;
  kind: "wire";
  expected: string;
  selected: string;
  correct: boolean;
  probabilities: Readonly<Record<string, number>>;
}> {
  const body = { ...item.body, model: modelId };
  const response = await requestJson({
    endpoint: config.SYSTEM_ONE_URL,
    apiKey: config.SYSTEM_ONE_API_KEY,
    body,
    label: "Decision replay",
    schema: decisionResponseSchema,
    timeoutMs: REQUEST_TIMEOUT_MS,
  });
  const answer = response.answers.next_action;
  return {
    id: item.id,
    kind: item.kind,
    expected: item.expectedChoice,
    selected: answer.choice,
    correct: answer.choice === item.expectedChoice,
    probabilities: answer.probabilities,
  };
}

async function runDecision(
  item: ReadonlyDeep<z.infer<typeof decisionCaseSchema>>,
  model: Readonly<SystemOneDecisionModel>,
): Promise<{
  id: string;
  kind: "decision";
  expected: boolean;
  selected: string;
  correct: boolean;
  completion: unknown;
  completionTarget: unknown;
  completionCommit: unknown;
  probabilities: Readonly<Record<string, number>>;
}> {
  // This calls only the decision model; no computer action is executed.
  const answer = await model.choose(asDecisionInput(item.input));
  return {
    id: item.id,
    kind: item.kind,
    expected: item.expectedFinish,
    selected: answer.action.kind,
    correct: (answer.action.kind === "finish") === item.expectedFinish,
    completion: answer.completion,
    completionTarget: answer.completionTarget,
    completionCommit: answer.completionCommit,
    probabilities: answer.probabilities,
  };
}

async function runCase(
  item: ReadonlyDeep<Case>,
  context: Readonly<{
    modelId: string;
    config: Config;
    model: Readonly<SystemOneDecisionModel>;
  }>,
): Promise<Awaited<ReturnType<typeof runWire>> | Awaited<ReturnType<typeof runDecision>>> {
  return item.kind === "wire"
    ? runWire(item, context.modelId, context.config)
    : runDecision(item, context.model);
}

async function run(provider: "clm" | "kev", wireOnly: boolean): Promise<void> {
  const corpus = corpusSchema.parse(await Bun.file(CORPUS).json());
  const currentSource = await sourceHash();
  if (!wireOnly && currentSource !== corpus.sourceHash) {
    throw new Error("Source changed after corpus freeze; rebuild and replay both providers");
  }
  const cases = wireOnly ? corpus.cases.filter((item) => item.kind === "wire") : corpus.cases;
  const loaded = await runtime(provider);
  const config = loadConfig();
  const model = new SystemOneDecisionModel(
    config.SYSTEM_ONE_URL,
    loaded.model,
    config.SYSTEM_ONE_API_KEY,
  );
  const startedAt = new Date().toISOString();
  const rows = [];
  for (const item of cases) {
    try {
      // Keep request order fixed across the two provider runs.
      // eslint-disable-next-line no-await-in-loop
      rows.push(await runCase(item, { modelId: loaded.model, config, model }));
    } catch (error) {
      rows.push({
        id: item.id,
        kind: item.kind,
        error: error instanceof Error ? error.message : "Decision failed",
        correct: false,
      });
    }
  }
  const artifact = {
    provider,
    wireOnly,
    runtime: loaded,
    corpusHash: sha256(JSON.stringify(corpus.cases)),
    wireHash: sha256(JSON.stringify(corpus.cases.filter((item) => item.kind === "wire"))),
    sourceHash: currentSource,
    startedAt,
    endedAt: new Date().toISOString(),
    endpoint: config.SYSTEM_ONE_URL,
    rows,
  };
  const path = `runs/recovery/provider-${provider}-${crypto.randomUUID()}.json`;
  await Bun.write(path, JSON.stringify(artifact, undefined, JSON_INDENT), { createPath: true });
  console.log(
    JSON.stringify({
      path,
      provider,
      correct: rows.filter((row) => row.correct).length,
      total: rows.length,
      errors: rows.filter((row) => "error" in row).length,
    }),
  );
}

async function compare(firstPath: string, secondPath: string): Promise<void> {
  const first = resultSchema.parse(await Bun.file(firstPath).json());
  const second = resultSchema.parse(await Bun.file(secondPath).json());
  if (first.corpusHash !== second.corpusHash) {
    throw new Error("Provider runs used different frozen input bodies");
  }
  const wireOnly =
    first.wireOnly === true || second.wireOnly === true || first.sourceHash !== second.sourceHash;
  const secondRows = new Map(
    second.rows.filter((row) => !wireOnly || row.kind === "wire").map((row) => [row.id, row]),
  );
  const rows = first.rows
    .filter((row) => !wireOnly || row.kind === "wire")
    .map((row) => {
      const other = secondRows.get(row.id);
      if (other === undefined) {
        throw new Error(`Missing ${row.id} in second run`);
      }
      return {
        id: row.id,
        first: row.selected,
        second: other.selected,
        firstCorrect: row.correct,
        secondCorrect: other.correct,
      };
    });
  console.log(
    JSON.stringify({
      first: first.provider,
      second: second.provider,
      corpusHash: first.corpusHash,
      wireOnly,
      sourceChanged: first.sourceHash !== second.sourceHash,
      rows,
    }),
  );
}

const [mode, arg1, arg2] = process.argv.slice(ARGUMENT_START);
if (mode === "build") {
  await build();
} else if (mode === "run" && (arg1 === "clm" || arg1 === "kev")) {
  await run(arg1, arg2 === "wire");
} else if (mode === "compare" && arg1 !== undefined && arg2 !== undefined) {
  await compare(arg1, arg2);
} else {
  throw new Error("Use build, run clm, run kev, or compare CLM_RESULT KEV_RESULT");
}
