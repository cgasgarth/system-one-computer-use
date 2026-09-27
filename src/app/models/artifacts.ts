import path from "node:path";
import { createHash } from "node:crypto";
import { chmod, mkdir, rename, rm } from "node:fs/promises";
import { z } from "zod";
import type { ReadonlyDeep } from "type-fest";
import { modelIdSchema } from "./catalog.ts";
import type { Preset } from "./catalog.ts";

const SHA = /^[0-9a-f]{40}$/u;
const HASH = /^[0-9a-f]{64}$/u;
const PRIVATE_DIRECTORY = 0o700;
const PRIVATE_FILE = 0o600;
const LOOKUP_TIMEOUT_MS = 10_000;
const sourceRoleSchema = z.enum(["checkpoint", "encoder", "head", "text"]);
const sourceSchema = z.strictObject({
  role: sourceRoleSchema,
  repository: z.string().min(1),
  revision: z.string().regex(SHA),
  assetFingerprint: z.string().regex(HASH),
});
const baseSchema = z.strictObject({
  repository: z.string().min(1),
  revision: z.string().regex(SHA),
  assetFingerprint: z.string().regex(HASH).optional(),
});
const artifactManifestSchema = z.strictObject({
  id: modelIdSchema,
  sources: z.array(sourceSchema).min(1),
  base: baseSchema.optional(),
});
const hubModelSchema = z.object({
  sha: z.string().regex(SHA),
  siblings: z
    .array(
      z.object({
        rfilename: z.string(),
        blobId: z.string().optional(),
        size: z.number().int().nonnegative().optional(),
        lfs: z.object({ sha256: z.string().regex(HASH) }).optional(),
      }),
    )
    .optional(),
});
interface SourceSpec {
  readonly role: z.infer<typeof sourceRoleSchema>;
  readonly repository: string;
  readonly weightFile?: string;
}
type ArtifactManifest = z.infer<typeof artifactManifestSchema>;
// The fetch SDK owns RequestInit's mutable shape at this external boundary.
// eslint-disable-next-line typescript/prefer-readonly-parameter-types
type ArtifactFetcher = (input: string, init?: RequestInit) => Promise<Response>;

function sourceSpecs(model: Readonly<Preset>): readonly SourceSpec[] {
  if (model.family === "clm") {
    return [
      { role: "encoder", repository: "Qwen/Qwen3-8B" },
      { role: "head", repository: model.hub, weightFile: "CLM_v0.1-8B.pt" },
    ];
  }
  if (model.family === "text") {
    return [{ role: "text", repository: model.hub }];
  }
  return [{ role: "checkpoint", repository: model.hub }];
}
function manifestPath(data: string, model: Readonly<Preset>): string {
  return path.join(data, "models", "artifacts", `${model.id}.json`);
}
const RUNTIME_FILE = /\.(?:safetensors|bin|pt|json|txt|model|py|c|bend|jinja|toml|tiktoken)$/iu;
const NON_RUNTIME_DIRECTORY = /^(?:metrics|tests|assets|docs|examples)\//u;
function runtimeAsset(filename: string, source: Readonly<SourceSpec>): boolean {
  if (source.weightFile !== undefined) {
    return filename === source.weightFile;
  }
  if (source.repository === "SupersonicLabs/Julia-1") {
    return (
      ((filename.startsWith("julia/") || !filename.includes("/")) &&
        RUNTIME_FILE.test(filename) &&
        !NON_RUNTIME_DIRECTORY.test(filename)) ||
      (/^(?:encoder|tokenizer)\//u.test(filename) && RUNTIME_FILE.test(filename))
    );
  }
  return RUNTIME_FILE.test(filename) && !NON_RUNTIME_DIRECTORY.test(filename);
}
function assetFingerprint(
  source: Readonly<SourceSpec>,
  siblings: ReadonlyDeep<NonNullable<z.infer<typeof hubModelSchema>["siblings"]>>,
): string {
  const assets = siblings
    .filter((sibling) => runtimeAsset(sibling.rfilename, source))
    .map((sibling) => {
      const digest = sibling.lfs?.sha256 ?? sibling.blobId;
      if (digest === undefined || sibling.size === undefined) {
        throw new Error(`Hugging Face omitted the hash or size of ${sibling.rfilename}.`);
      }
      return `${sibling.rfilename}\t${digest}\t${sibling.size}`;
    })
    .toSorted();
  if (assets.length === 0) {
    throw new Error(`Hugging Face listed no runtime assets for ${source.repository}.`);
  }
  return createHash("sha256").update(assets.join("\n")).digest("hex");
}
function validateManifest(raw: unknown, model: Readonly<Preset>): ArtifactManifest {
  const manifest = artifactManifestSchema.parse(raw);
  const expected = sourceSpecs(model);
  if (
    manifest.id !== model.id ||
    manifest.sources.length !== expected.length ||
    manifest.sources.some(
      (source, index) =>
        source.role !== expected[index]?.role || source.repository !== expected[index].repository,
    )
  ) {
    throw new Error(`The saved artifact manifest does not match ${model.name}.`);
  }
  return manifest;
}
async function readManifest(
  data: string,
  model: Readonly<Preset>,
): Promise<ArtifactManifest | undefined> {
  const file = Bun.file(manifestPath(data, model));
  return (await file.exists()) ? validateManifest(await file.json(), model) : undefined;
}
async function readBaseOutput(file: string): Promise<z.infer<typeof baseSchema>> {
  return baseSchema.parse(await Bun.file(file).json());
}
// The optional signal guards the atomic acceptance step after file preparation.
// eslint-disable-next-line eslint/max-params
async function writeManifest(
  data: string,
  model: Readonly<Preset>,
  manifest: ReadonlyDeep<ArtifactManifest>,
  signal?: Readonly<AbortSignal>,
): Promise<void> {
  const file = manifestPath(data, model);
  await mkdir(path.dirname(file), { recursive: true, mode: PRIVATE_DIRECTORY });
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    await Bun.write(temporary, JSON.stringify(manifest));
    await chmod(temporary, PRIVATE_FILE);
    signal?.throwIfAborted();
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}
interface HubLookup {
  readonly fetcher: ArtifactFetcher;
  readonly signal?: Readonly<AbortSignal> | undefined;
  readonly revision?: string;
}
async function hubInfo(
  repository: string,
  lookup: Readonly<HubLookup>,
): Promise<z.infer<typeof hubModelSchema>> {
  const address = `https://huggingface.co/api/models/${repository}${lookup.revision === undefined ? "" : `/revision/${lookup.revision}`}?blobs=true`;
  const timeout = AbortSignal.timeout(LOOKUP_TIMEOUT_MS);
  const response = await lookup.fetcher(address, {
    signal: lookup.signal === undefined ? timeout : AbortSignal.any([timeout, lookup.signal]),
  });
  if (!response.ok) {
    throw new Error(
      `Could not check ${repository}: Hugging Face returned HTTP ${response.status}.`,
    );
  }
  return hubModelSchema.parse(await response.json());
}
async function latestManifest(
  model: Readonly<Preset>,
  fetcher: ArtifactFetcher = fetch,
  signal?: Readonly<AbortSignal>,
): Promise<ArtifactManifest> {
  const sources = await Promise.all(
    sourceSpecs(model).map(async (source) => {
      const info = await hubInfo(source.repository, { fetcher, signal });
      if (info.siblings === undefined) {
        throw new Error(`Hugging Face omitted artifact metadata for ${source.repository}.`);
      }
      return {
        role: source.role,
        repository: source.repository,
        revision: info.sha,
        assetFingerprint: assetFingerprint(source, info.siblings),
      };
    }),
  );
  return { id: model.id, sources };
}
async function resolvedBaseFingerprint(
  base: Readonly<z.infer<typeof baseSchema>>,
  fetcher: ArtifactFetcher = fetch,
  signal?: Readonly<AbortSignal>,
): Promise<z.infer<typeof baseSchema>> {
  const info = await hubInfo(base.repository, { fetcher, revision: base.revision, signal });
  if (info.sha !== base.revision || info.siblings === undefined) {
    throw new Error("The checkpoint-declared base did not resolve to its exact revision.");
  }
  return {
    ...base,
    assetFingerprint: assetFingerprint(
      { role: "encoder", repository: base.repository },
      info.siblings,
    ),
  };
}
function hasNewerArtifacts(
  current: ReadonlyDeep<ArtifactManifest>,
  latest: ReadonlyDeep<ArtifactManifest>,
): boolean {
  return current.sources.some(
    (source, index) => source.assetFingerprint !== latest.sources[index]?.assetFingerprint,
  );
}

export {
  artifactManifestSchema,
  hasNewerArtifacts,
  latestManifest,
  manifestPath,
  readBaseOutput,
  resolvedBaseFingerprint,
  readManifest,
  validateManifest,
  writeManifest,
};
export type { ArtifactFetcher, ArtifactManifest };
