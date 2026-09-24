import { expect, test } from "bun:test";
import { ChatCompletionTextModel } from "../src/models/text.ts";
import { textRequestSchema } from "../src/models/text-schema.ts";
import type { TextRequest } from "../src/models/text-schema.ts";
import { expectFailure } from "./fixtures.ts";

const REPAIR_CALLS = 2;

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
    await expectFailure(model.prepare("Open Settings"), "Could not plan this task");
  } finally {
    await server.stop(true);
  }
});

test("repairs a missing app field before returning a trusted plan", async () => {
  let calls = 0;
  const server = Bun.serve({
    async fetch(request) {
      const body = textRequestSchema.parse(await request.json());
      calls += 1;
      if (calls > 1) {
        expect(body.messages[0]?.content).toContain("Validation error");
      }
      const content = calls === 1 ? '{"goal":"open_app"}' : '{"goal":"open_app","app":"Calendar"}';
      return Response.json({ choices: [{ message: { content } }] });
    },
    port: 0,
  });
  try {
    const model = new ChatCompletionTextModel(server.url.href, "small-text");
    expect(await model.prepare("open my calendar")).toEqual({ goal: "open_app", app: "Calendar" });
    expect(calls).toBe(REPAIR_CALLS);
  } finally {
    await server.stop(true);
  }
});

test("resolves a named website through search without guessing its domain", async () => {
  const server = Bun.serve({
    fetch() {
      return Response.json({
        choices: [{ message: { content: '{"goal":"open_website","website":"open table"}' } }],
      });
    },
    port: 0,
  });
  try {
    const model = new ChatCompletionTextModel(server.url.href, "small-text");
    const plan = await model.prepare("open chrome and go to open table");
    expect(plan).toEqual({
      goal: "open_website",
      website: "open table",
      url: "https://www.google.com/search?q=open+table+official+website",
    });
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
