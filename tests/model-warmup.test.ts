import { expect, spyOn, test } from "bun:test";
import { ModelHost } from "../src/app/models/host.ts";
import { preferencesSchema } from "../src/app/models/catalog.ts";

const SETTLE_MS = 20;
test("keeps draft warm-up ready under cold policy, then unloads after a task releases it", async () => {
  const output = spyOn(console, "log").mockImplementation(() => {
    /* Silence host status events. */
  });
  const host = new ModelHost({
    paths: { data: "/tmp/unused", integrations: "/tmp/unused", uv: "/tmp/unused" },
    preferences: preferencesSchema.parse({
      retention: "cold",
      decision: { source: "endpoint", model: "decision", url: "http://127.0.0.1:1/decision" },
      text: { source: "endpoint", model: "text", url: "http://127.0.0.1:1/text" },
    }),
  });
  try {
    await host.warm();
    await Bun.sleep(SETTLE_MS);
    expect(host.decision.status().state).toBe("ready");
    expect(host.text.status().state).toBe("ready");
    await host.prepare("task-1");
    host.release();
    await Bun.sleep(SETTLE_MS);
    expect(host.decision.status().state).toBe("unloaded");
    expect(host.text.status().state).toBe("unloaded");
  } finally {
    await host.close();
    output.mockRestore();
  }
});
