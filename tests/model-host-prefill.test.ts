import { expect, spyOn, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { once } from "node:events";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { defaultPreferences } from "../src/app/models/catalog.ts";
import { ModelHost } from "../src/app/models/host.ts";
import { inferenceRequestSchema } from "../src/models/transport/protocol.ts";

const PROMPT_VARIANTS = 3;
const NO_WORK_WAIT_MS = 30;
const PROMPT_TOKENS = 100;

async function fixture(): Promise<{
  readonly host: ModelHost;
  readonly seeded: Promise<boolean>;
  readonly count: () => number;
  readonly close: () => Promise<void>;
}> {
  const data = await mkdtemp(path.join(os.tmpdir(), "system-one-prefill-"));
  const host = new ModelHost({
    paths: { data, integrations: "/unused", uv: "/unused" },
    preferences: { ...defaultPreferences, retention: "warm" },
  });
  await mkdir(host.sockets.directory, { recursive: true, mode: 0o700 });
  let requests = 0;
  const seeded = Promise.withResolvers<boolean>();
  const server = createServer((socket) => {
    socket.once("data", (chunk) => {
      const frame = inferenceRequestSchema.parse(JSON.parse(chunk.toString().trim()));
      expect(frame.role).toBe("text");
      if (frame.role === "text") {
        expect(frame.body.max_tokens).toBe(1);
      }
      requests += 1;
      socket.end(
        `${JSON.stringify({
          ok: true,
          body: {
            choices: [{ message: { content: "x" }, finish_reason: "length" }],
            usage: {
              prompt_tokens: PROMPT_TOKENS,
              prompt_tokens_details: { cached_tokens: 0 },
            },
          },
        })}\n`,
      );
      if (requests === PROMPT_VARIANTS) {
        seeded.resolve(true);
      }
    });
  });
  server.listen(host.sockets.text);
  await once(server, "listening");
  const decisionEnsure = spyOn(host.decision, "ensure").mockResolvedValue();
  const textEnsure = spyOn(host.text, "ensure").mockResolvedValue();
  return {
    host,
    seeded: seeded.promise,
    count: () => requests,
    async close() {
      decisionEnsure.mockRestore();
      textEnsure.mockRestore();
      const closed = once(server, "close");
      server.close();
      await closed;
      await host.close();
      await rm(data, { recursive: true, force: true });
    },
  };
}

test("a held task prevents background text prefill and a later warm seeds once", async () => {
  const { host, seeded, count, close } = await fixture();
  try {
    await host.prepare("task");
    await host.warm();
    await Bun.sleep(NO_WORK_WAIT_MS);
    expect(count()).toBe(0);
    host.release();
    await host.warm();
    await seeded;
    expect(count()).toBe(PROMPT_VARIANTS);
    await host.warm();
    await Bun.sleep(NO_WORK_WAIT_MS);
    expect(count()).toBe(PROMPT_VARIANTS);
  } finally {
    await close();
  }
});
