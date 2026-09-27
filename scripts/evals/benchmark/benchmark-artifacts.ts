import { latestManifest } from "../../../src/app/models/artifacts.ts";
import type { ArtifactManifest } from "../../../src/app/models/artifacts.ts";
import type { Preset } from "../../../src/app/models/catalog.ts";
import type { ReadonlyDeep } from "type-fest";

type ArtifactSelection =
  | {
      readonly status: "resolved";
      readonly modelId: Preset["id"];
      readonly lookupMs: number;
      readonly manifest: ReadonlyDeep<ArtifactManifest>;
    }
  | {
      readonly status: "lookup-failed";
      readonly modelId: Preset["id"];
      readonly lookupMs: number;
      readonly reason: string;
    };
function sourceFingerprint(manifest: ReadonlyDeep<ArtifactManifest>, role: string): string {
  const source = manifest.sources.find((entry) => entry.role === role);
  if (source === undefined) {
    throw new Error(`${manifest.id} has no ${role} runtime source.`);
  }
  return source.assetFingerprint;
}
function checkClmWeights(selections: readonly ArtifactSelection[]): void {
  const clm = selections.filter(
    (item): item is Extract<ArtifactSelection, { status: "resolved" }> =>
      item.status === "resolved" && item.modelId.startsWith("clm-"),
  );
  const [first] = clm;
  if (first === undefined) {
    return;
  }
  for (const candidate of clm.slice(1)) {
    for (const role of ["encoder", "head"] as const) {
      if (sourceFingerprint(first.manifest, role) !== sourceFingerprint(candidate.manifest, role)) {
        throw new Error(
          `CLM presets resolved different ${role} assets. Recheck latest before benchmarking.`,
        );
      }
    }
  }
}
async function resolveArtifacts(
  models: readonly Readonly<Preset>[],
): Promise<readonly ArtifactSelection[]> {
  const selections = await Promise.all(
    models.map(async (model): Promise<ArtifactSelection> => {
      const started = performance.now();
      try {
        const manifest = await latestManifest(model);
        return {
          status: "resolved",
          modelId: model.id,
          lookupMs: performance.now() - started,
          manifest,
        };
      } catch (error) {
        return {
          status: "lookup-failed",
          modelId: model.id,
          lookupMs: performance.now() - started,
          reason: error instanceof Error ? error.message : "Could not resolve latest artifacts.",
        };
      }
    }),
  );
  checkClmWeights(selections);
  return selections;
}
function preparedArtifact(
  selections: readonly ArtifactSelection[],
  model: Readonly<Preset>,
): ReadonlyDeep<ArtifactManifest> | undefined {
  const found = selections.find((item) => item.modelId === model.id);
  return found?.status === "resolved" ? found.manifest : undefined;
}
export { checkClmWeights, preparedArtifact, resolveArtifacts };
export type { ArtifactSelection };
