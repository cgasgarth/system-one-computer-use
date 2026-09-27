import { expect, test } from "bun:test";
import {
  DEFAULT_MAX_CHOICES,
  defaultPreferences,
  preferencesSchema,
  preset,
} from "../src/app/models/catalog.ts";
import { commands } from "../src/app/models/commands.ts";
import { maxChoices, modelName } from "../src/app/models/preferences.ts";
import type { ArtifactManifest } from "../src/app/models/artifacts.ts";
import type { Preset } from "../src/app/models/catalog.ts";

const SOCKET_PATH = "/tmp/system-one-model-tests/decision.sock";
const UV_PREFIX_LENGTH = 6;
const JULIA_MAX_CHOICES = 20;
const REVISION_LENGTH = 40;
const FINGERPRINT_LENGTH = 64;
const REVISION = "a".repeat(REVISION_LENGTH);
const FINGERPRINT = "b".repeat(FINGERPRINT_LENGTH);
const paths = {
  data: "/tmp/system-one-model-tests",
  integrations: "/tmp/integrations",
  uv: "/usr/local/bin/uv",
};
function source(
  role: ArtifactManifest["sources"][number]["role"],
  repository: string,
): ArtifactManifest["sources"][number] {
  return { role, repository, revision: REVISION, assetFingerprint: FINGERPRINT };
}
function artifacts(model: Readonly<Preset>): ArtifactManifest {
  return {
    id: model.id,
    sources:
      model.family === "clm"
        ? [source("encoder", "Qwen/Qwen3-8B"), source("head", model.hub)]
        : [source(model.family === "text" ? "text" : "checkpoint", model.hub)],
  };
}
test("validates model roles at the settings boundary", () => {
  expect(preferencesSchema.parse(defaultPreferences)).toEqual(defaultPreferences);
  expect(
    preferencesSchema.safeParse({
      ...defaultPreferences,
      decision: { source: "local", id: "qwen-text-2b" },
    }).success,
  ).toBe(false);
  expect(
    preferencesSchema.safeParse({ ...defaultPreferences, text: { source: "local", id: "kev-4b" } })
      .success,
  ).toBe(false);
});
test("accepts external HTTP endpoints with an explicit model ID", () => {
  expect(
    preferencesSchema.parse({
      ...defaultPreferences,
      decision: {
        source: "endpoint",
        url: "https://models.example/v1/systemone",
        model: "another-model",
      },
    }).decision.source,
  ).toBe("endpoint");
  expect(
    preferencesSchema.safeParse({
      ...defaultPreferences,
      decision: { source: "endpoint", url: "file:///tmp/model", model: "test" },
    }).success,
  ).toBe(false);
});
test("uses the pinned Kev checkpoint through the local Unix bridge", () => {
  const model = preset("kev-0.8b");
  const command = commands({ model, socket: SOCKET_PATH, paths, manifest: artifacts(model) });
  expect(command.serve).toContain("/tmp/integrations/local-bridge/serve.py");
  expect(command.serve).toContain(SOCKET_PATH);
  expect(command.serve).toContain("kev");
  expect(command.serve).toContain(`jaredpalmer/kev-0.8b@${REVISION}`);
  expect(command.environment["KEV_BACKEND"]).toBe("mlx");
  expect(command.environment["UV_PROJECT_ENVIRONMENT"]).toContain("runtimes/kev-mlx");
});
test("selects CLM weight precision without changing the decision protocol", () => {
  const model = preset("clm-8b-q8");
  const command = commands({ model, socket: SOCKET_PATH, paths, manifest: artifacts(model) });
  expect(command.serve).toContain("/tmp/integrations/local-bridge/serve.py");
  expect(command.serve).toContain("clm");
  expect(command.serve).toContain("8");
});
test("uses the pinned Julia snapshot with a declared twenty-choice CPU service", () => {
  const selection = { source: "local", id: "julia-1" } as const;
  const model = preset(selection.id);
  const command = commands({ model, socket: SOCKET_PATH, paths, manifest: artifacts(model) });
  expect(modelName(selection)).toBe("julia-latest");
  expect(maxChoices(selection)).toBe(JULIA_MAX_CHOICES);
  expect(maxChoices(defaultPreferences.decision)).toBe(DEFAULT_MAX_CHOICES);
  expect(command.download).toContain("/tmp/integrations/julia-cpu/download.py");
  expect(command.serve).toContain("julia");
  expect(command.serve).toContain(SOCKET_PATH);
  expect(command.environment["UV_PROJECT_ENVIRONMENT"]).toContain("runtimes/julia-cpu");
  expect(command.environment["JULIA_CPU_THREADS"]).toBe("4");
});
test("serves all local models with the uv-managed Python after uv downloads", () => {
  for (const [id, project] of [
    ["kev-4b", "kev-mlx"],
    ["clm-8b-q4", "clm-mlx"],
    ["julia-1", "julia-cpu"],
    ["qwen-text-2b", "clm-mlx"],
  ] as const) {
    const model = preset(id);
    const command = commands({ model, socket: SOCKET_PATH, paths, manifest: artifacts(model) });
    expect(command.download.slice(0, UV_PREFIX_LENGTH)).toEqual([
      paths.uv,
      "run",
      "--project",
      `${paths.integrations}/${project}`,
      "--frozen",
      "--no-editable",
    ]);
    expect(command.serve[0]).toBe(`${paths.data}/runtimes/${project}/bin/python3`);
    expect(command.serve[1]).toBe(`${paths.integrations}/local-bridge/serve.py`);
  }
});
