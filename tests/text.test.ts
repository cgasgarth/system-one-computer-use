import { expect, test } from "bun:test";
import { ChatCompletionTextModel } from "../src/models/text.ts";
import { textRequestSchema, textResponseSchema } from "../src/models/text-schema.ts";
import { desktopFixture, windowFixture } from "./fixtures.ts";

test("asks the text provider for field content with the task and session context", async () => {
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = textRequestSchema.parse(await request.json());
      expect(body.model).toBe("writer");
      expect(body.messages.at(-1)?.content).toContain("previous request");
      expect(body.messages.at(-1)?.content).toContain("Search");
      return Response.json({ choices: [{ message: { content: "Alex" }, finish_reason: "stop" }] });
    },
  });
  try {
    const model = new ChatCompletionTextModel(server.url.href, "writer");
    expect(
      await model.generate({
        task: "Find recent texts",
        context: "previous request",
        observation: { desktop: desktopFixture(), window: windowFixture() },
        purpose: "text",
        field: { label: "Search", value: "" },
      }),
    ).toBe("Alex");
  } finally {
    await server.stop(true);
  }
});

test("rejects truncated text before it can become input", () => {
  expect(() =>
    textResponseSchema.parse({
      choices: [{ message: { content: "unfinished" }, finish_reason: "length" }],
    }),
  ).toThrow("Text model response was incomplete");
});
