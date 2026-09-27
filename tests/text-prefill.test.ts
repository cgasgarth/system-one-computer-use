import { expect, test } from "bun:test";
import { TextPrefill } from "../src/app/models/text-prefill.ts";
import { textPrefillRequests } from "../src/models/text.ts";
import { textPrefillResponseSchema, textResponseSchema } from "../src/models/text-schema.ts";

const SYSTEM_PROMPT_HASHES = [
  "6c022046e909a94143106a094f82f25ab365784b65f153e93164adb2f45eda48",
  "c41ad795ce1615662047dc08fd616c2d736081dcf90c3391fbe30fef3805ec05",
  "18ccc08744b16379c8ccc6a27c766555e68884eb44e52a5990ea01f212feb9f2",
] as const;
const PROMPT_COUNT = SYSTEM_PROMPT_HASHES.length;
const NEXT_GENERATION = 2;
const PROMPT_TOKENS = 180;

test("prefill uses the unchanged three text-system prompts", () => {
  const requests = textPrefillRequests("writer");
  expect(requests).toHaveLength(PROMPT_COUNT);
  expect(
    requests.map((request) =>
      new Bun.CryptoHasher("sha256").update(request.messages[0]?.content ?? "").digest("hex"),
    ),
  ).toEqual([...SYSTEM_PROMPT_HASHES]);
  expect(requests.every((request) => request.max_tokens === 1 && request.model === "writer")).toBe(
    true,
  );
});

test("one-token prefill accepts a length stop without weakening normal text validation", () => {
  const response = {
    choices: [{ message: { content: "x" }, finish_reason: "length" }],
    usage: { prompt_tokens: PROMPT_TOKENS, prompt_tokens_details: { cached_tokens: 0 } },
  };
  expect(textPrefillResponseSchema.parse(response).usage.prompt_tokens).toBe(PROMPT_TOKENS);
  expect(() => textResponseSchema.parse(response)).toThrow("Text model response was incomplete");
  expect(
    textResponseSchema.parse({
      choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
      usage: { prompt_tokens: PROMPT_TOKENS, prompt_tokens_details: { cached_tokens: 9 } },
    }).usage,
  ).toEqual({ prompt_tokens: PROMPT_TOKENS, prompt_tokens_details: { cached_tokens: 9 } });
});

test("prefill runs once per loaded generation", async () => {
  const sent: string[] = [];
  const prefill = new TextPrefill({
    socketPath: "/unused.sock",
    async send(request): Promise<void> {
      sent.push(request.messages[0]?.content ?? "");
    },
  });
  await prefill.start(1, "writer");
  await prefill.start(1, "writer");
  expect(sent).toHaveLength(PROMPT_COUNT);
  await prefill.start(NEXT_GENERATION, "writer");
  expect(sent).toHaveLength(PROMPT_COUNT * NEXT_GENERATION);
});

test("task cancellation stops a warm job without restarting it from a queued duplicate", async () => {
  const entered = Promise.withResolvers<boolean>();
  let sent = 0;
  let hold = true;
  const prefill = new TextPrefill({
    socketPath: "/unused.sock",
    async send(_request, signal): Promise<void> {
      sent += 1;
      if (!hold) {
        return;
      }
      entered.resolve(true);
      const cancelled = Promise.withResolvers<boolean>();
      signal.addEventListener(
        "abort",
        () => {
          cancelled.reject(new Error("Prefill was cancelled."));
        },
        { once: true },
      );
      await cancelled.promise;
    },
  });
  const first = prefill.start(1, "writer");
  await entered.promise;
  const duplicate = prefill.start(1, "writer");
  prefill.cancel();
  await Promise.all([first, duplicate]);
  expect(sent).toBe(1);
  hold = false;
  await prefill.start(1, "writer");
  expect(sent).toBe(PROMPT_COUNT + 1);
});

test("a queued newer generation does not restart after task cancellation", async () => {
  const entered = Promise.withResolvers<boolean>();
  const sent: string[] = [];
  const prefill = new TextPrefill({
    socketPath: "/unused.sock",
    async send(request, signal): Promise<void> {
      sent.push(request.model);
      if (request.model === "old") {
        entered.resolve(true);
        const cancelled = Promise.withResolvers<boolean>();
        signal.addEventListener(
          "abort",
          () => {
            cancelled.reject(new Error("The old prefill was cancelled."));
          },
          { once: true },
        );
        await cancelled.promise;
      }
    },
  });
  const old = prefill.start(1, "old");
  await entered.promise;
  const newer = prefill.start(NEXT_GENERATION, "new");
  prefill.cancel();
  await Promise.all([old, newer]);
  expect(sent.filter((model) => model === "old")).toHaveLength(1);
  expect(sent.filter((model) => model === "new")).toHaveLength(0);
  await prefill.start(NEXT_GENERATION, "new");
  expect(sent.filter((model) => model === "new")).toHaveLength(PROMPT_COUNT);
});
