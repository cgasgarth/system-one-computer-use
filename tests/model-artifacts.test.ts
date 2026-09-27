import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  hasNewerArtifacts,
  latestManifest,
  readManifest,
  resolvedBaseFingerprint,
  writeManifest,
} from "../src/app/models/artifacts.ts";
import { preset } from "../src/app/models/catalog.ts";

const REVISION_LENGTH = 40;
const FINGERPRINT_LENGTH = 64;
const FIRST_REVISION = "a".repeat(REVISION_LENGTH);
const SECOND_REVISION = "b".repeat(REVISION_LENGTH);
const WEIGHT_HASH = "c".repeat(FINGERPRINT_LENGTH);
const NEW_WEIGHT_HASH = "d".repeat(FINGERPRINT_LENGTH);
const MODEL = preset("julia-1");
// Match the fetch SDK argument at the mocked external boundary.
// eslint-disable-next-line typescript/prefer-readonly-parameter-types
type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;
function hubResponse(revision: string, weightHash = WEIGHT_HASH): Fetcher {
  return async () =>
    Response.json({
      sha: revision,
      siblings: [
        { rfilename: "README.md", blobId: "documentation", size: 8 },
        { rfilename: "model.safetensors", size: 123, lfs: { sha256: weightHash } },
        { rfilename: "julia/inference.py", size: 20, blobId: "source" },
        { rfilename: "metrics/development.json", size: 10, blobId: "metrics" },
      ],
    });
}
test("stores an exact resolved model revision and ignores documentation-only updates", async () => {
  const first = await latestManifest(MODEL, hubResponse(FIRST_REVISION));
  const documentationOnly = await latestManifest(MODEL, hubResponse(SECOND_REVISION));
  const newWeights = await latestManifest(MODEL, hubResponse(SECOND_REVISION, NEW_WEIGHT_HASH));
  expect(first.sources[0]?.revision).toBe(FIRST_REVISION);
  expect(hasNewerArtifacts(first, documentationOnly)).toBe(false);
  expect(hasNewerArtifacts(first, newWeights)).toBe(true);
  const directory = await mkdtemp(path.join(tmpdir(), "system-one-artifacts-"));
  try {
    await writeManifest(directory, MODEL, first);
    expect(await readManifest(directory, MODEL)).toEqual(first);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("rejects a saved manifest for another repository", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "system-one-artifacts-"));
  try {
    const file = path.join(directory, "models", "artifacts", `${MODEL.id}.json`);
    await Bun.write(
      file,
      JSON.stringify({
        id: MODEL.id,
        sources: [
          {
            role: "checkpoint",
            repository: "other/model",
            revision: FIRST_REVISION,
            assetFingerprint: WEIGHT_HASH,
          },
        ],
      }),
    );
    let failure: unknown = new Error("Expected manifest rejection.");
    try {
      await readManifest(directory, MODEL);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test("fingerprints the checkpoint-declared base at its exact revision", async () => {
  const base = { repository: "Qwen/Qwen3.5-4B-Base", revision: FIRST_REVISION };
  let address = "";
  const result = await resolvedBaseFingerprint(base, async (input) => {
    address = input;
    return Response.json({
      sha: FIRST_REVISION,
      siblings: [
        { rfilename: "config.json", size: 12, blobId: "config" },
        { rfilename: "model.safetensors", size: 123, lfs: { sha256: WEIGHT_HASH } },
      ],
    });
  });
  expect(address).toContain(`/revision/${FIRST_REVISION}?blobs=true`);
  expect(result.repository).toBe(base.repository);
  expect(result.revision).toBe(FIRST_REVISION);
  expect(result.assetFingerprint).toHaveLength(WEIGHT_HASH.length);
});
