import path from "node:path";
import type { ReadonlyDeep } from "type-fest";
import type { Preset } from "./catalog.ts";
import { manifestPath } from "./artifacts.ts";
import type { ArtifactManifest } from "./artifacts.ts";

interface RuntimePaths {
  readonly integrations: string;
  readonly data: string;
  readonly uv: string;
}
interface ModelCommand {
  readonly download: string[];
  readonly serve: string[];
  readonly readyMessage: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly baseOutput?: string;
}
interface CommandInput {
  readonly model: Readonly<Preset>;
  readonly socket: string;
  readonly paths: Readonly<RuntimePaths>;
  readonly manifest: ReadonlyDeep<ArtifactManifest>;
}
interface CommandBase {
  readonly input: Readonly<CommandInput>;
  readonly project: string;
  readonly prefix: string[];
  readonly serve: string[];
  readonly environment: NodeJS.ProcessEnv;
}
const READY = "SYSTEM_ONE_MODEL_READY";
function projectName(model: Readonly<Preset>): string {
  if (model.family === "kev") {
    return "kev-mlx";
  }
  return model.family === "julia" ? "julia-cpu" : "clm-mlx";
}
function revision(
  manifest: ReadonlyDeep<ArtifactManifest>,
  role: ArtifactManifest["sources"][number]["role"],
): string {
  const source = manifest.sources.find((item) => item.role === role);
  if (source === undefined) {
    throw new Error(`The ${manifest.id} artifact manifest lacks ${role}.`);
  }
  return source.revision;
}
function kevCommands(base: ReadonlyDeep<CommandBase>): ModelCommand {
  const { model, paths, manifest } = base.input;
  const run = `${model.hub}@${revision(manifest, "checkpoint")}`;
  const baseOutput = `${manifestPath(paths.data, model)}.base`;
  return {
    environment: base.environment,
    readyMessage: READY,
    download: [
      ...base.prefix,
      path.join(base.project, "download.py"),
      "--run",
      run,
      "--base-output",
      baseOutput,
    ],
    serve: [...base.serve, "--run", run],
    baseOutput,
  };
}
function clmCommands(base: ReadonlyDeep<CommandBase>): ModelCommand {
  const encoder = revision(base.input.manifest, "encoder");
  const head = revision(base.input.manifest, "head");
  return {
    environment: base.environment,
    readyMessage: READY,
    download: [
      ...base.prefix,
      "-m",
      "clm_mlx.download",
      "--encoder-revision",
      encoder,
      "--head-revision",
      head,
    ],
    serve: [
      ...base.serve,
      "--bits",
      String(base.input.model.bits),
      "--encoder-revision",
      encoder,
      "--head-revision",
      head,
    ],
  };
}
function juliaCommands(base: ReadonlyDeep<CommandBase>): ModelCommand {
  const selected = revision(base.input.manifest, "checkpoint");
  return {
    environment: { ...base.environment, JULIA_CPU_THREADS: "4" },
    readyMessage: READY,
    download: [...base.prefix, path.join(base.project, "download.py"), "--revision", selected],
    serve: [...base.serve, "--revision", selected],
  };
}
function textCommands(base: ReadonlyDeep<CommandBase>): ModelCommand {
  const { model, paths, manifest } = base.input;
  return {
    environment: base.environment,
    readyMessage: READY,
    download: [
      ...base.prefix,
      "-m",
      "clm_mlx.download",
      "--text-model",
      model.hub,
      "--text-revision",
      revision(manifest, "text"),
      "--text-output",
      path.join(paths.data, "models", model.id),
    ],
    serve: [...base.serve, "--model-path", path.join(paths.data, "models", model.id)],
  };
}
function commands(input: Readonly<CommandInput>): ModelCommand {
  const { model, socket, paths, manifest } = input;
  if (manifest.id !== model.id) {
    throw new Error("The model and artifact manifest do not match.");
  }
  const project = path.join(paths.integrations, projectName(model));
  const runtime = path.join(paths.data, "runtimes", projectName(model));
  const base: CommandBase = {
    input,
    project,
    prefix: [
      paths.uv,
      "run",
      "--project",
      project,
      "--frozen",
      "--no-editable",
      "--reinstall-package",
      `system-one-${projectName(model)}`,
      "python",
    ],
    serve: [
      path.join(runtime, "bin", "python3"),
      path.join(paths.integrations, "local-bridge", "serve.py"),
      "--provider",
      model.family,
      "--socket",
      socket,
    ],
    environment: {
      ...Bun.env,
      UV_PROJECT_ENVIRONMENT: runtime,
      PYTHONUNBUFFERED: "1",
      PYTHONDONTWRITEBYTECODE: "1",
      HF_HUB_DISABLE_PROGRESS_BARS: "1",
      KEV_BACKEND: "mlx",
    },
  };
  if (model.family === "kev") {
    return kevCommands(base);
  }
  if (model.family === "clm") {
    return clmCommands(base);
  }
  return model.family === "julia" ? juliaCommands(base) : textCommands(base);
}
export { commands };
export type { CommandInput, ModelCommand, RuntimePaths };
