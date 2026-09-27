import path from "node:path";
import type { ReadonlyDeep } from "type-fest";
import type { ArtifactManifest } from "../../../src/app/models/artifacts.ts";
import type { Preset } from "../../../src/app/models/catalog.ts";
import type { RuntimePaths } from "../../../src/app/models/commands.ts";

const JULIA_CPU_THREADS = 4;
interface ModelProvenance {
  readonly id: string;
  readonly name: string;
  readonly family: string;
  readonly runtime: string;
  readonly hub: string;
  readonly bits: number;
  readonly maxChoices?: number;
  readonly wireModel: string;
  readonly artifact: ReadonlyDeep<ArtifactManifest>;
  readonly juliaCpuConfiguration?: {
    readonly torch: "2.14.0";
    readonly transformers: "5.0.0";
    readonly threads: typeof JULIA_CPU_THREADS;
    readonly strictEncoding: true;
    readonly markerOnlyHead: false;
  };
  readonly serveArguments: readonly string[];
  readonly projectLockSha256: string;
  readonly bridgeSha256: string;
  readonly downloadSourceSha256: string;
  readonly artifactHashLimit: string;
}

async function sha256(file: string): Promise<string> {
  const hash = new Bun.CryptoHasher("sha256");
  hash.update(await Bun.file(file).arrayBuffer());
  return hash.digest("hex");
}
function runtimeLabel(model: Readonly<Preset>): string {
  if (model.family === "kev") {
    return "Kev MLX BF16 (Apple GPU)";
  }
  if (model.family === "clm") {
    return model.bits === 0 ? "CLM MLX BF16 (Apple GPU)" : `CLM MLX ${model.bits}-bit (Apple GPU)`;
  }
  if (model.family === "text") {
    return "Qwen 3.5 2B MLX 4-bit (Apple GPU)";
  }
  return "Julia Torch CPU FP32";
}
function projectName(model: Readonly<Preset>): string {
  if (model.family === "kev") {
    return "kev-mlx";
  }
  return model.family === "julia" ? "julia-cpu" : "clm-mlx";
}
function downloadSource(model: Readonly<Preset>, projectPath: string): string {
  if (model.family === "kev" || model.family === "julia") {
    return path.join(projectPath, "download.py");
  }
  return path.join(projectPath, "src/clm_mlx/download.py");
}
async function modelProvenance(input: {
  readonly model: Readonly<Preset>;
  readonly paths: Readonly<RuntimePaths>;
  readonly serve: readonly string[];
  readonly wireModel: string;
  readonly maxChoices?: number;
  readonly artifact: ReadonlyDeep<ArtifactManifest>;
}): Promise<ModelProvenance> {
  const { model, paths, serve, wireModel, maxChoices, artifact } = input;
  const project = projectName(model);
  const projectPath = path.join(paths.integrations, project);
  const source = downloadSource(model, projectPath);
  return {
    id: model.id,
    name: model.name,
    family: model.family,
    runtime: runtimeLabel(model),
    hub: model.hub,
    bits: model.bits,
    ...(maxChoices === undefined ? {} : { maxChoices }),
    wireModel,
    artifact,
    ...(model.family === "julia"
      ? {
          juliaCpuConfiguration: {
            torch: "2.14.0" as const,
            transformers: "5.0.0" as const,
            threads: JULIA_CPU_THREADS,
            strictEncoding: true as const,
            markerOnlyHead: false as const,
          },
        }
      : {}),
    serveArguments: serve,
    projectLockSha256: await sha256(path.join(projectPath, "uv.lock")),
    bridgeSha256: await sha256(path.join(paths.integrations, "local-bridge/serve.py")),
    downloadSourceSha256: await sha256(source),
    artifactHashLimit:
      "Revisions and asset fingerprints come from Hugging Face metadata. Local weight bytes are not rehashed by this benchmark.",
  };
}

export { modelProvenance, runtimeLabel, sha256 };
export type { ModelProvenance };
