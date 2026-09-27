import { expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ModelSlot } from "../src/app/models/slot.ts";
import { preset } from "../src/app/models/catalog.ts";
import { readManifest } from "../src/app/models/artifacts.ts";
import type { ArtifactFetcher } from "../src/app/models/artifacts.ts";

const REVISION_LENGTH = 40;
const HASH_LENGTH = 64;
const CHECKPOINT = "a".repeat(REVISION_LENGTH);
const BASE = "b".repeat(REVISION_LENGTH);
const WEIGHT = "c".repeat(HASH_LENGTH);
const EXECUTABLE = 0o755;

async function fakeRuntimes(directory: string): Promise<{ uv: string; integrations: string }> {
  const integrations = path.join(directory, "integrations");
  const runtime = path.join(directory, "runtimes", "kev-mlx", "bin");
  const uv = path.join(directory, "uv");
  const python = path.join(runtime, "python3");
  const server = path.join(directory, "serve.mjs");
  await mkdir(runtime, { recursive: true });
  await mkdir(path.join(directory, "models", "artifacts"), { recursive: true });
  await Bun.write(
    uv,
    `#!/bin/sh
previous=""
for item in "$@"; do
  if [ "$previous" = "--base-output" ]; then
    printf '%s' '{"repository":"Qwen/Qwen3.5-4B-Base","revision":"${BASE}"}' > "$item"
  fi
  previous="$item"
done
`,
  );
  await Bun.write(
    server,
    `import { createServer } from "node:net";
const index = process.argv.indexOf("--socket");
const socket = process.argv[index + 1];
const answer = JSON.stringify({ok:true,body:{answers:{next_action:{choice:"A0",probabilities:{A0:1,A1:0}}}}}) + "\\n";
const listener = createServer((client) => client.once("data", () => client.end(answer)));
listener.listen(socket, () => process.stderr.write("SYSTEM_ONE_MODEL_READY\\n"));
`,
  );
  await Bun.write(
    python,
    `#!/bin/sh
exec "${process.execPath}" "${server}" "$@"
`,
  );
  await chmod(uv, EXECUTABLE);
  await chmod(python, EXECUTABLE);
  return { uv, integrations };
}
async function createFixture(
  directory: string,
  controls: Readonly<{
    started: () => void;
    aborted: () => void;
    baseReply: Promise<Response>;
  }>,
): Promise<{ slot: ModelSlot; statusCount: () => number }> {
  const fetcher: ArtifactFetcher = async (address, init) => {
    if (address.includes("/revision/")) {
      init?.signal?.addEventListener("abort", controls.aborted, { once: true });
      controls.started();
      return controls.baseReply;
    }
    return Response.json({
      sha: CHECKPOINT,
      siblings: [{ rfilename: "adapter_model.safetensors", size: 128, lfs: { sha256: WEIGHT } }],
    });
  };
  const paths = { data: directory, ...(await fakeRuntimes(directory)) };
  let statusChanges = 0;
  const slot = new ModelSlot({
    role: "decision",
    selection: { source: "local", id: "kev-4b" },
    socketPath: path.join(directory, "decision.sock"),
    paths,
    changed: (): void => {
      statusChanges += 1;
    },
    artifactFetch: fetcher,
  });
  return { slot, statusCount: () => statusChanges };
}

test("closing during exact-base metadata lookup cannot accept a new manifest", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "system-one-artifact-close-"));
  const started = Promise.withResolvers<true>();
  const aborted = Promise.withResolvers<true>();
  const baseReply = Promise.withResolvers<Response>();
  const { slot, statusCount } = await createFixture(directory, {
    started: () => {
      started.resolve(true);
    },
    aborted: () => {
      aborted.resolve(true);
    },
    baseReply: baseReply.promise,
  });
  try {
    let loadError: unknown = "Loading completed unexpectedly.";
    const loading = (async (): Promise<void> => {
      try {
        await slot.ensure();
      } catch (error) {
        loadError = error;
      }
    })();
    await started.promise;
    const closing = slot.close();
    await aborted.promise;
    baseReply.resolve(
      Response.json({
        sha: BASE,
        siblings: [{ rfilename: "model.safetensors", size: 256, lfs: { sha256: WEIGHT } }],
      }),
    );
    await Promise.all([loading, closing]);
    expect(loadError).toBeInstanceOf(Error);
    expect(statusCount()).toBeGreaterThan(0);
    expect(await readManifest(directory, preset("kev-4b"))).toBeUndefined();
  } finally {
    baseReply.resolve(Response.json({ sha: BASE, siblings: [] }));
    await slot.close();
    await rm(directory, { recursive: true, force: true });
  }
});
