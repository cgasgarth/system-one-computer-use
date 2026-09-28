import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { once } from "node:events";
import { z } from "zod";

const TIMEOUT_MS = 5000;
const TEST_TIMEOUT_MS = 10_000;
const eventSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("approval_requested"), requestId: z.uuid() }),
  z.object({ status: z.literal("reply"), matched: z.boolean() }),
  z.object({ status: z.literal("resolved"), actions: z.array(z.string()) }),
]);

async function runWorker(): Promise<{
  readonly exit: number | null;
  readonly stderr: string;
  readonly messages: readonly z.infer<typeof eventSchema>[];
}> {
  const child = spawn(process.execPath, ["tests/fixtures/approval-worker.ts"], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  const timeout = setTimeout(() => {
    child.kill("SIGKILL");
  }, TIMEOUT_MS);
  const messages: z.infer<typeof eventSchema>[] = [];
  let stderr = "";
  child.stderr.on("data", (chunk: Readonly<Buffer>) => {
    stderr += chunk.toString();
  });
  try {
    child.stdin.write(
      `${JSON.stringify({
        kind: "task",
        mode: "desktop",
        task: "Fixture approval",
        session: { mode: "auto" },
      })}\n`,
    );
    for await (const line of createInterface({ input: child.stdout })) {
      const event = eventSchema.parse(JSON.parse(line));
      messages.push(event);
      if (event.status === "approval_requested") {
        // Foundation.JSONEncoder emits uppercase UUID hex after decoding the prompt.
        child.stdin.write(
          `${JSON.stringify({
            kind: "approval_response",
            requestId: event.requestId.toUpperCase(),
            decision: "allow_task",
          })}\n`,
        );
      }
      if (event.status === "resolved") {
        child.stdin.end();
      }
    }
    const exitEvent = child.exitCode === null ? await once(child, "exit") : undefined;
    const exit = child.exitCode ?? z.number().nullable().parse(exitEvent?.[0]);
    return { exit, stderr, messages };
  } finally {
    clearTimeout(timeout);
    if (child.exitCode === null) {
      child.kill("SIGKILL");
    }
  }
}

test(
  "Swift uppercase approval UUID reaches an in-flight worker task over real stdio",
  async () => {
    const { exit, stderr, messages } = await runWorker();
    expect(exit).toBe(0);
    expect(stderr).toBe("");
    expect(messages.filter((event) => event.status === "approval_requested")).toHaveLength(1);
    expect(messages.find((event) => event.status === "reply")).toMatchObject({ matched: true });
    expect(messages.find((event) => event.status === "resolved")).toMatchObject({
      actions: ["accept", "accept"],
    });
  },
  TEST_TIMEOUT_MS,
);
