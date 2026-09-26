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
        field: { role: "textbox", label: "Search", value: "" },
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

test("application argument keeps the current request, historical reference, tool, and installed names", async () => {
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = textRequestSchema.parse(await request.json());
      expect(body.messages[1]?.content).toContain("Make a new calendar item");
      expect(body.messages[1]?.content).toContain("Previous request: Open Calendar");
      expect(body.messages[1]?.content).toContain("Switch to another installed Mac application");
      expect(body.messages[1]?.content).toContain("Reminders");
      expect(body.messages[1]?.content).toContain("Messages");
      return Response.json({
        choices: [{ message: { content: "Calendar" }, finish_reason: "stop" }],
      });
    },
  });
  try {
    const model = new ChatCompletionTextModel(server.url.href, "writer");
    const result = await model.generate({
      task: "Make a new calendar item",
      context: "Previous request: Open Calendar",
      observation: { desktop: desktopFixture(), window: windowFixture() },
      purpose: "application",
      applications: ["Calendar", "Reminders"],
      tool: "Switch to another installed Mac application",
    });
    expect(result).toBe("Calendar");
  } finally {
    await server.stop(true);
  }
});

test("supplies observed link destinations to the URL argument writer", async () => {
  const destination = "https://example.test/doc/opaque-72";
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const body = textRequestSchema.parse(await request.json());
      expect(body.messages.at(-1)?.content).toContain(destination);
      return Response.json({
        choices: [{ message: { content: destination }, finish_reason: "stop" }],
      });
    },
  });
  try {
    const window = windowFixture();
    const model = new ChatCompletionTextModel(server.url.href, "writer");
    const url = await model.generate({
      task: "Open the budget document",
      context: "",
      purpose: "url",
      observation: {
        desktop: desktopFixture(),
        window: {
          ...window,
          elements: [
            {
              element_index: 1,
              element_token: "link",
              role: "link",
              label: "Budget",
              href: destination,
              actions: ["AXPress"],
            },
          ],
        },
      },
    });
    expect(url).toBe(destination);
  } finally {
    await server.stop(true);
  }
});
