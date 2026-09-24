import { expect, test } from "bun:test";
import { ChatCompletionTextModel } from "../src/models/text.ts";
import { textRequestSchema } from "../src/models/text-schema.ts";
import type { TextRequest } from "../src/models/text-schema.ts";
import { expectFailure } from "./fixtures.ts";

test("accepts a task plan from a text provider", async () => {
  const captured = Promise.withResolvers<TextRequest>();
  const server = Bun.serve({
    async fetch(request) {
      captured.resolve(textRequestSchema.parse(await request.json()));
      return Response.json({
        choices: [{ message: { content: JSON.stringify({ app: "Settings", goal: "open_app" }) } }],
      });
    },
    port: 0,
  });
  try {
    const model = new ChatCompletionTextModel(server.url.href, "small-text");
    const plan = await model.prepare("Open Settings");
    const request = await captured.promise;
    expect(request.model).toBe("small-text");
    expect(plan).toEqual({ app: "Settings", goal: "open_app" });
  } finally {
    await server.stop(true);
  }
});

test("rejects prose in place of a task plan", async () => {
  const server = Bun.serve({
    fetch() {
      return Response.json({ choices: [{ message: { content: "Open Settings now." } }] });
    },
    port: 0,
  });
  try {
    const model = new ChatCompletionTextModel(server.url.href, "small-text");
    await expectFailure(model.prepare("Open Settings"), "valid task-plan JSON");
  } finally {
    await server.stop(true);
  }
});

test("accepts fenced JSON and grounds its fields in the user task", async () => {
  const server = Bun.serve({
    async fetch(request) {
      const input = textRequestSchema.parse(await request.json());
      if (input.messages[0]?.content.startsWith("Classify") === true) {
        return Response.json({ choices: [{ message: { content: "enter_text" } }] });
      }
      return Response.json({
        choices: [
          {
            message: {
              content:
                '```json\n{"goal":"task","app":"Flight Search","url":"https://example.com","textToEnter":"ORD to JFK"}\n```',
            },
          },
        ],
      });
    },
    port: 0,
  });
  try {
    const model = new ChatCompletionTextModel(server.url.href, "small-text");
    const plan = await model.prepare("Type ORD to JFK into the route field");
    expect(plan).toEqual({ goal: "enter_text", textToEnter: "ORD to JFK" });
  } finally {
    await server.stop(true);
  }
});
