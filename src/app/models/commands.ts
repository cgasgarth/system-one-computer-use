import path from "node:path";
import type { Preset } from "./catalog.ts";

const KEV_REVISIONS = {
  "kev-0.8b": "9a45d25eb2ab761841196625383fa1dff0e56c1e",
  "kev-4b": "139fdd94f1b6a6ad80cc15e08fcb99cac885a101",
  "kev-9b": "2629c06a5aeb0feb3b9783bafed17ed8f39ecf5c",
} as const;
interface RuntimePaths {
  readonly integrations: string;
  readonly data: string;
  readonly uv: string;
}
function checkpoint(model: Preset): string {
  if (model.id === "kev-0.8b" || model.id === "kev-4b" || model.id === "kev-9b") {
    return `${model.hub}@${KEV_REVISIONS[model.id]}`;
  }
  return model.hub;
}
function commands(
  model: Preset,
  port: number,
  paths: RuntimePaths,
): { download: string[]; serve: string[]; readyMessage: string; environment: NodeJS.ProcessEnv } {
  const projectName = model.family === "kev" ? "kev-mlx" : "clm-mlx";
  const project = path.join(paths.integrations, projectName);
  const prefix = [paths.uv, "run", "--project", project, "--frozen", "python"];
  const environment = {
    ...Bun.env,
    UV_PROJECT_ENVIRONMENT: path.join(paths.data, "runtimes", projectName),
    PYTHONUNBUFFERED: "1",
    PYTHONDONTWRITEBYTECODE: "1",
    HF_HUB_DISABLE_PROGRESS_BARS: "1",
    KEV_BACKEND: "mlx",
  };
  if (model.family === "kev") {
    return {
      environment,
      readyMessage: `Uvicorn running on http://127.0.0.1:${port}`,
      download: [...prefix, path.join(project, "download.py"), "--run", checkpoint(model)],
      serve: [...prefix, "-m", "kev.serve", "--run", checkpoint(model), "--port", String(port)],
    };
  }
  if (model.family === "clm") {
    return {
      environment,
      readyMessage: `Uvicorn running on http://127.0.0.1:${port}`,
      download: [...prefix, "-m", "clm_mlx.download"],
      serve: [
        ...prefix,
        "-m",
        "clm_mlx.server",
        "--bits",
        String(model.bits),
        "--port",
        String(port),
      ],
    };
  }
  return {
    environment,
    readyMessage: `Starting httpd at 127.0.0.1 on port ${port}...`,
    download: [
      ...prefix,
      "-m",
      "clm_mlx.download",
      "--text-model",
      model.hub,
      "--text-output",
      path.join(paths.data, "models", model.id),
    ],
    serve: [
      ...prefix,
      "-m",
      "mlx_lm",
      "server",
      "--model",
      path.join(paths.data, "models", model.id),
      "--port",
      String(port),
      "--chat-template-args",
      '{"enable_thinking":false}',
    ],
  };
}
export { commands };
export type { RuntimePaths };
