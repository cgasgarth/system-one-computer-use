import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { ModelHost } from "../src/app/models/host.ts";
import { expectFailure } from "./fixtures.ts";

const SETTLE_MS = 20;
const preferences = {
  retention: "cold" as const,
  decision: { source: "endpoint" as const, url: "https://decision.example/api", model: "decision" },
  text: { source: "endpoint" as const, url: "https://text.example/api", model: "text" },
};

for (const operation of ["warm", "prepare"] as const) {
  test(`${operation} failure releases the idle hold`, async () => {
    const data = await mkdtemp("/tmp/system-one-lifecycle-");
    const host = new ModelHost({
      paths: { data, integrations: "/unused", uv: "/unused" },
      preferences,
    });
    try {
      await host.decision.ensure();
      await host.text.ensure();
      host.decision.ensure = async (): Promise<void> => {
        throw new Error("Planned load failure");
      };
      await expectFailure(
        operation === "warm" ? host.warm() : host.prepare("qa"),
        "Planned load failure",
      );
      await Bun.sleep(SETTLE_MS);
      expect(host.text.status().state).toBe("unloaded");
    } finally {
      await host.close();
      await rm(data, { recursive: true, force: true });
    }
  });
}

test("configure failure restores idle cleanup even before settings are saved", async () => {
  const data = await mkdtemp("/tmp/system-one-lifecycle-");
  const host = new ModelHost({
    paths: { data, integrations: "/unused", uv: "/unused" },
    preferences,
  });
  const unload = host.decision.unload.bind(host.decision);
  let calls = 0;
  try {
    await host.decision.ensure();
    host.decision.unload = async (): Promise<void> => {
      calls += 1;
      if (calls === 1) {
        throw new Error("Planned unload failure");
      }
      await unload();
    };
    await expectFailure(
      host.configure({
        ...preferences,
        decision: { ...preferences.decision, url: "https://other.example/api" },
      }),
      "Planned unload failure",
    );
    await Bun.sleep(SETTLE_MS);
    expect(calls).toBeGreaterThan(1);
  } finally {
    await host.close();
    await rm(data, { recursive: true, force: true });
  }
});

test("close blocks a queued warm before it can load the next model", async () => {
  const data = await mkdtemp("/tmp/system-one-lifecycle-");
  const host = new ModelHost({
    paths: { data, integrations: "/unused", uv: "/unused" },
    preferences,
  });
  const pending = Promise.withResolvers<number>();
  const started = Promise.withResolvers<number>();
  let textLoads = 0;
  host.decision.ensure = async (): Promise<void> => {
    started.resolve(1);
    await pending.promise;
  };
  host.text.ensure = async (): Promise<void> => {
    textLoads += 1;
  };
  try {
    const warm = expectFailure(host.warm(), "Model host is closed");
    await started.promise;
    const close = host.close();
    pending.resolve(1);
    await close;
    await warm;
    expect(textLoads).toBe(0);
    await expectFailure(host.warm(), "Model host is closed");
    await expectFailure(host.prepare("after-close"), "Model host is closed");
  } finally {
    pending.resolve(1);
    await host.close();
    await rm(data, { recursive: true, force: true });
  }
});
