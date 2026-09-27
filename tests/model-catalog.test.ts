import { expect, test } from "bun:test";
import { defaultPreferences, preferencesSchema, preset } from "../src/app/models/catalog.ts";
import { commands } from "../src/app/models/commands.ts";

const SOCKET_PATH = "/tmp/system-one-model-tests/decision.sock";
const UV_PREFIX_LENGTH = 6;
const paths = {
  data: "/tmp/system-one-model-tests",
  integrations: "/tmp/integrations",
  uv: "/usr/local/bin/uv",
};
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
  const command = commands(preset("kev-0.8b"), SOCKET_PATH, paths);
  expect(command.serve).toContain("/tmp/integrations/local-bridge/serve.py");
  expect(command.serve).toContain(SOCKET_PATH);
  expect(command.serve).toContain("kev");
  expect(command.serve).toContain("jaredpalmer/kev-0.8b@9a45d25eb2ab761841196625383fa1dff0e56c1e");
  expect(command.environment["KEV_BACKEND"]).toBe("mlx");
  expect(command.environment["UV_PROJECT_ENVIRONMENT"]).toContain("runtimes/kev-mlx");
});
test("selects CLM weight precision without changing the decision protocol", () => {
  const command = commands(preset("clm-8b-q8"), SOCKET_PATH, paths);
  expect(command.serve).toContain("/tmp/integrations/local-bridge/serve.py");
  expect(command.serve).toContain("clm");
  expect(command.serve).toContain("8");
});
test("serves all local models with the uv-managed Python after uv downloads", () => {
  for (const [id, project] of [
    ["kev-4b", "kev-mlx"],
    ["clm-8b-q4", "clm-mlx"],
    ["qwen-text-2b", "clm-mlx"],
  ] as const) {
    const command = commands(preset(id), SOCKET_PATH, paths);
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
