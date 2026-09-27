import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ModelHost } from "../src/app/models/host.ts";

const request = {
  role: "decision" as const,
  body: {
    model: "julia-latest",
    state: "Current window",
    questions: {
      next_action: {
        type: "choice" as const,
        instructions: "Choose.",
        criteria: { A0: "First", A1: "Second" },
      },
    },
  },
};
test("reserves an update before metadata work and rejects a concurrent inference request", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "system-one-update-"));
  const host = new ModelHost({
    paths: { integrations: "/unused", data: directory, uv: "/unused" },
    preferences: {
      decision: { source: "local", id: "julia-1" },
      text: { source: "endpoint", url: "https://example.test/text", model: "text" },
      retention: "warm",
    },
  });
  const pending = Promise.withResolvers<boolean>();
  host.decision.updateLatest = async (): Promise<boolean> => pending.promise;
  try {
    const update = host.updateModel("decision");
    let failure: unknown = new Error("Expected the update reservation to reject inference.");
    try {
      await host.forward(request, new AbortController().signal);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    if (failure instanceof Error) {
      expect(failure.message).toContain("update is in progress");
    }
    pending.resolve(false);
    await update;
  } finally {
    pending.resolve(false);
    await host.close();
    await rm(directory, { recursive: true, force: true });
  }
});
